/**
 * Tests for the export CLI command
 */

import { describe, it, expect } from 'vitest';
import { exportCommand } from '../../src/cli/export.js';

describe('Export Command', () => {
  it('should be defined', () => {
    expect(exportCommand).toBeDefined();
  });

  it('should have correct name', () => {
    expect(exportCommand.name()).toBe('export');
  });

  it('should have description', () => {
    expect(exportCommand.description()).toBeTruthy();
    expect(exportCommand.description()).toContain('Parquet');
  });

  it('should have --data-dir option', () => {
    const options = exportCommand.options;
    const dataDirOption = options.find(o => o.long === '--data-dir');
    expect(dataDirOption).toBeDefined();
    expect(dataDirOption?.defaultValue).toBe('./data');
  });

  it('should have --output option', () => {
    const options = exportCommand.options;
    const outputOption = options.find(o => o.long === '--output');
    expect(outputOption).toBeDefined();
    expect(outputOption?.defaultValue).toBe('./export');
  });

  it('should have --formats option', () => {
    const options = exportCommand.options;
    const formatsOption = options.find(o => o.long === '--formats');
    expect(formatsOption).toBeDefined();
  });

  it('should have --types option', () => {
    const options = exportCommand.options;
    const typesOption = options.find(o => o.long === '--types');
    expect(typesOption).toBeDefined();
  });

  it('should have --row-group-size option', () => {
    const options = exportCommand.options;
    const rowGroupOption = options.find(o => o.long === '--row-group-size');
    expect(rowGroupOption).toBeDefined();
    expect(rowGroupOption?.defaultValue).toBe('10000');
  });

  it('should have --limit option', () => {
    const options = exportCommand.options;
    const limitOption = options.find(o => o.long === '--limit');
    expect(limitOption).toBeDefined();
  });

  it('should have --verbose option', () => {
    const options = exportCommand.options;
    const verboseOption = options.find(o => o.long === '--verbose');
    expect(verboseOption).toBeDefined();
  });
});
