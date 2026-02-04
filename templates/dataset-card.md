---
license: cc-by-sa-4.0
language:
- en
tags:
- wikipedia
- embeddings
- bge-m3
- gemma
- semantic-search
- text-embeddings
task_categories:
- feature-extraction
- sentence-similarity
size_categories:
- 1M<n<10M
configs:
- config_name: default
  data_files:
    - split: train
      path: "data/*.parquet"
---

# Wikipedia Embeddings (English)

## Dataset Description

Pre-computed BGE-M3 and Gemma embeddings for approximately 6 million English Wikipedia articles.

This dataset enables efficient semantic search over Wikipedia without requiring on-the-fly embedding generation.

**Key Features:**
- High-quality dense embeddings from state-of-the-art models
- Partitioned by article type (person, place, org, work, event, other)
- Optimized Parquet format for fast loading
- Compatible with HuggingFace datasets, FAISS, and other vector search tools
- Compact format without full content for efficient storage

## Dataset Summary

| Property | Value |
|----------|-------|
| Articles | ~6,000,000 |
| Embeddings | ~12,000,000 |
| Models | bge-m3, gemma |
| Total Dimensions | 1792 (1024 + 768) |
| Estimated Size | ~45 GB |
| Content Included | No |
| Version | 1.0.0 |

## Embedding Models

### BGE-M3

- **Model**: BAAI/bge-m3
- **Dimensions**: 1024
- **Type**: Dense multilingual embedding model
- **Description**: State-of-the-art multilingual embedding model supporting 100+ languages with strong performance on retrieval tasks.

### GEMMA

- **Model**: Google Gemma
- **Dimensions**: 768
- **Type**: Dense embedding model
- **Description**: Google's efficient embedding model optimized for semantic similarity and retrieval.

## Schema

```
{
  // Article metadata
  "id": "string",              // Unique article identifier
  "title": "string",           // Article title
  "type": "string",            // person, place, org, work, event, other
  "wikidata_id": "string?",    // Wikidata Q-number (nullable)
  "content_length": "int32",   // Character count

  // Embeddings
  "embedding_bge_m3": "list<float32>",  // 1024-dimensional
  "embedding_gemma": "list<float32>",   // 768-dimensional (optional)

  // Metadata
  "model_version": "string",   // Embedding model version
  "created_at": "timestamp"    // Creation timestamp
}
```

## Usage

### Loading the Dataset

```python
from datasets import load_dataset

# Load the full dataset
ds = load_dataset("dotdo/wikipedia-embeddings-en")

# Stream for large datasets
ds = load_dataset("dotdo/wikipedia-embeddings-en", streaming=True)

# Access embeddings
for example in ds["train"]:
    title = example["title"]
    embedding = example["embedding_bge_m3"]
    print(f"{title}: {len(embedding)} dimensions")
```

### Semantic Search Example

```python
import numpy as np
from datasets import load_dataset
from sentence_transformers import SentenceTransformer

# Load dataset and model
ds = load_dataset("dotdo/wikipedia-embeddings-en")
model = SentenceTransformer("BAAI/bge-m3")

# Get all embeddings as numpy array
embeddings = np.array(ds["train"]["embedding_bge_m3"])
titles = ds["train"]["title"]

# Query
query = "What is machine learning?"
query_embedding = model.encode(query)

# Cosine similarity
similarities = np.dot(embeddings, query_embedding) / (
    np.linalg.norm(embeddings, axis=1) * np.linalg.norm(query_embedding)
)

# Top 5 results
top_indices = np.argsort(similarities)[-5:][::-1]
for idx in top_indices:
    print(f"{titles[idx]}: {similarities[idx]:.4f}")
```

### With FAISS for Efficient Search

```python
import faiss
import numpy as np
from datasets import load_dataset

ds = load_dataset("dotdo/wikipedia-embeddings-en")
embeddings = np.array(ds["train"]["embedding_bge_m3"], dtype=np.float32)

# Build FAISS index
dimension = embeddings.shape[1]
index = faiss.IndexFlatIP(dimension)  # Inner product (cosine after normalization)

# Normalize for cosine similarity
faiss.normalize_L2(embeddings)
index.add(embeddings)

# Search
query = np.random.rand(1, dimension).astype(np.float32)
faiss.normalize_L2(query)
distances, indices = index.search(query, k=10)
```

### Filtering by Article Type

```python
# Filter to only people articles
people = ds["train"].filter(lambda x: x["type"] == "person")

# Filter to places
places = ds["train"].filter(lambda x: x["type"] == "place")
```

## Statistics

### Articles by Type

| Type | Count | Percentage |
|------|-------|------------|
| person | ~1,800,000 | 30% |
| place | ~1,200,000 | 20% |
| org | ~600,000 | 10% |
| work | ~900,000 | 15% |
| event | ~300,000 | 5% |
| other | ~1,200,000 | 20% |

**Total**: ~6,000,000 articles

## License

This dataset is released under the **Creative Commons Attribution-ShareAlike 4.0 International** license.

This dataset is derived from Wikipedia and is released under the same license as Wikipedia content.

License details: https://creativecommons.org/licenses/by-sa/4.0/

### Attribution

When using this dataset, please cite both this dataset and Wikipedia:

> Wikipedia contributors. Wikipedia, The Free Encyclopedia. https://www.wikipedia.org/

## Citation

If you use this dataset in your research, please cite:

```bibtex
@dataset{wikipedia_embeddings_en_2024,
  title = {Wikipedia Embeddings Dataset},
  author = {DotDo},
  year = {2024},
  publisher = {HuggingFace},
  url = {https://huggingface.co/datasets/dotdo/wikipedia-embeddings-en},
  note = {Pre-computed embeddings for English Wikipedia articles}
}
```

Source code: https://github.com/dotdo/wikipedia.org.ai

## Acknowledgments

- **Wikipedia** and all its contributors for creating and maintaining this invaluable resource
- **BAAI** for the BGE-M3 embedding model
- **Google** for the Gemma model
- **HuggingFace** for hosting and dataset infrastructure
- **Cloudflare** for AI inference infrastructure

---

*Generated by wikipedia.org.ai*
