/**
 * Tests for configuration schema validation
 */

import { describe, it, expect } from 'vitest';
import {
  CliConfigSchema,
  WorkerEnvSchema,
  validateCliConfig,
  safeValidateCliConfig,
  validateWorkerEnv,
  safeValidateWorkerEnv,
  formatValidationError,
} from '../../src/lib/config-schema.js';

describe('Config Schema', () => {
  describe('CliConfigSchema', () => {
    it('should accept empty config', () => {
      const result = CliConfigSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept valid complete config', () => {
      const config = {
        dataDir: '/path/to/data',
        aiGatewayUrl: 'https://gateway.ai.cloudflare.com/v1/account/gateway',
        accountId: 'abc123',
        apiToken: 'token-xyz',
        defaultModel: '@cf/baai/bge-base-en-v1.5',
        batchSize: 100,
        port: 8080,
      };
      const result = CliConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(config);
      }
    });

    it('should accept partial config', () => {
      const config = {
        dataDir: '/data',
        port: 3000,
      };
      const result = CliConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dataDir).toBe('/data');
        expect(result.data.port).toBe(3000);
        expect(result.data.aiGatewayUrl).toBeUndefined();
      }
    });

    describe('aiGatewayUrl validation', () => {
      it('should accept valid URL', () => {
        const result = CliConfigSchema.safeParse({
          aiGatewayUrl: 'https://example.com/api',
        });
        expect(result.success).toBe(true);
      });

      it('should reject invalid URL', () => {
        const result = CliConfigSchema.safeParse({
          aiGatewayUrl: 'not-a-url',
        });
        expect(result.success).toBe(false);
      });

      it('should accept URL with port', () => {
        const result = CliConfigSchema.safeParse({
          aiGatewayUrl: 'http://localhost:8787/ai',
        });
        expect(result.success).toBe(true);
      });
    });

    describe('batchSize validation', () => {
      it('should accept positive integers', () => {
        const result = CliConfigSchema.safeParse({ batchSize: 100 });
        expect(result.success).toBe(true);
      });

      it('should reject zero', () => {
        const result = CliConfigSchema.safeParse({ batchSize: 0 });
        expect(result.success).toBe(false);
      });

      it('should reject negative numbers', () => {
        const result = CliConfigSchema.safeParse({ batchSize: -10 });
        expect(result.success).toBe(false);
      });

      it('should reject non-integers', () => {
        const result = CliConfigSchema.safeParse({ batchSize: 50.5 });
        expect(result.success).toBe(false);
      });
    });

    describe('port validation', () => {
      it('should accept valid port numbers', () => {
        expect(CliConfigSchema.safeParse({ port: 1 }).success).toBe(true);
        expect(CliConfigSchema.safeParse({ port: 80 }).success).toBe(true);
        expect(CliConfigSchema.safeParse({ port: 8080 }).success).toBe(true);
        expect(CliConfigSchema.safeParse({ port: 65535 }).success).toBe(true);
      });

      it('should reject port 0', () => {
        const result = CliConfigSchema.safeParse({ port: 0 });
        expect(result.success).toBe(false);
      });

      it('should reject ports over 65535', () => {
        const result = CliConfigSchema.safeParse({ port: 65536 });
        expect(result.success).toBe(false);
      });

      it('should reject negative ports', () => {
        const result = CliConfigSchema.safeParse({ port: -1 });
        expect(result.success).toBe(false);
      });

      it('should reject non-integers', () => {
        const result = CliConfigSchema.safeParse({ port: 8080.5 });
        expect(result.success).toBe(false);
      });
    });

    describe('string field validation', () => {
      it('should accept any string for dataDir', () => {
        const result = CliConfigSchema.safeParse({ dataDir: '/any/path' });
        expect(result.success).toBe(true);
      });

      it('should accept any string for accountId', () => {
        const result = CliConfigSchema.safeParse({ accountId: 'my-account-123' });
        expect(result.success).toBe(true);
      });

      it('should accept any string for apiToken', () => {
        const result = CliConfigSchema.safeParse({ apiToken: 'secret-token' });
        expect(result.success).toBe(true);
      });

      it('should accept any string for defaultModel', () => {
        const result = CliConfigSchema.safeParse({ defaultModel: '@cf/baai/bge-base-en-v1.5' });
        expect(result.success).toBe(true);
      });
    });
  });

  describe('WorkerEnvSchema', () => {
    it('should accept valid minimal config', () => {
      const env = {
        AI_GATEWAY_URL: 'https://gateway.ai.cloudflare.com/v1/account/gateway',
        ENVIRONMENT: 'production',
      };
      const result = WorkerEnvSchema.safeParse(env);
      expect(result.success).toBe(true);
    });

    it('should accept valid config with API_KEYS', () => {
      const env = {
        AI_GATEWAY_URL: 'https://gateway.ai.cloudflare.com/v1/account/gateway',
        ENVIRONMENT: 'staging',
        API_KEYS: 'key1,key2,key3',
      };
      const result = WorkerEnvSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.API_KEYS).toBe('key1,key2,key3');
      }
    });

    describe('ENVIRONMENT validation', () => {
      it('should accept staging', () => {
        const result = WorkerEnvSchema.safeParse({
          AI_GATEWAY_URL: 'https://example.com',
          ENVIRONMENT: 'staging',
        });
        expect(result.success).toBe(true);
      });

      it('should accept production', () => {
        const result = WorkerEnvSchema.safeParse({
          AI_GATEWAY_URL: 'https://example.com',
          ENVIRONMENT: 'production',
        });
        expect(result.success).toBe(true);
      });

      it('should reject invalid environment', () => {
        const result = WorkerEnvSchema.safeParse({
          AI_GATEWAY_URL: 'https://example.com',
          ENVIRONMENT: 'development',
        });
        expect(result.success).toBe(false);
      });
    });

    describe('AI_GATEWAY_URL validation', () => {
      it('should reject invalid URL', () => {
        const result = WorkerEnvSchema.safeParse({
          AI_GATEWAY_URL: 'not-a-url',
          ENVIRONMENT: 'production',
        });
        expect(result.success).toBe(false);
      });

      it('should require AI_GATEWAY_URL', () => {
        const result = WorkerEnvSchema.safeParse({
          ENVIRONMENT: 'production',
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe('validateCliConfig', () => {
    it('should return validated config for valid input', () => {
      const config = validateCliConfig({ port: 8080 });
      expect(config.port).toBe(8080);
    });

    it('should throw for invalid input', () => {
      expect(() => validateCliConfig({ port: -1 })).toThrow();
    });
  });

  describe('safeValidateCliConfig', () => {
    it('should return success for valid config', () => {
      const result = safeValidateCliConfig({ port: 8080 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.port).toBe(8080);
      }
    });

    it('should return error for invalid config', () => {
      const result = safeValidateCliConfig({ port: 'invalid' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    });
  });

  describe('validateWorkerEnv', () => {
    it('should return validated env for valid input', () => {
      const env = validateWorkerEnv({
        AI_GATEWAY_URL: 'https://example.com',
        ENVIRONMENT: 'production',
      });
      expect(env.ENVIRONMENT).toBe('production');
    });

    it('should throw for invalid input', () => {
      expect(() => validateWorkerEnv({})).toThrow();
    });
  });

  describe('safeValidateWorkerEnv', () => {
    it('should return success for valid env', () => {
      const result = safeValidateWorkerEnv({
        AI_GATEWAY_URL: 'https://example.com',
        ENVIRONMENT: 'staging',
      });
      expect(result.success).toBe(true);
    });

    it('should return error for invalid env', () => {
      const result = safeValidateWorkerEnv({
        AI_GATEWAY_URL: 'not-a-url',
        ENVIRONMENT: 'invalid',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('formatValidationError', () => {
    it('should format single error', () => {
      const result = CliConfigSchema.safeParse({ port: -1 });
      expect(result.success).toBe(false);
      if (!result.success) {
        const formatted = formatValidationError(result.error);
        expect(formatted).toContain('port');
      }
    });

    it('should format multiple errors', () => {
      const result = CliConfigSchema.safeParse({
        port: 'invalid',
        batchSize: -1,
        aiGatewayUrl: 'not-a-url',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const formatted = formatValidationError(result.error);
        expect(formatted).toContain('port');
        expect(formatted).toContain('batchSize');
        expect(formatted).toContain('aiGatewayUrl');
      }
    });

    it('should handle errors without path', () => {
      // Create a simple error to test path-less formatting
      const result = CliConfigSchema.safeParse({ port: 'string' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const formatted = formatValidationError(result.error);
        expect(formatted.length).toBeGreaterThan(0);
      }
    });
  });
});
