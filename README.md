# LitFunnel

**AI-powered academic literature retrieval tool — from hundreds of papers to a 20-paper research skeleton.**

LitFunnel helps researchers build a structured literature foundation through a three-layer funnel model: **Trunk** (broad retrieval), **Branch** (methodology verification), and **Network** (citation-based discovery). The result is a curated 20-paper "skeleton" organized into three tiers — Foundation, Mainstream, and Frontier — that forms the backbone of your research.

## Why LitFunnel?

Traditional literature search gives you a ranked list. LitFunnel gives you a **research structure**.

Instead of skimming 200 abstracts and picking randomly, you:
1. Describe your research direction in natural language
2. Get AI-expanded search results across multiple query dimensions
3. Build a skeleton of 20 key papers, categorized by their role in the field
4. Verify each paper's methodology against your technical focus
5. Discover overlooked papers through citation network analysis

The funnel converges: broad search → filtered results → verified skeleton → network-supplemented collection.

## Features

**Conversational Retrieval** — Chat-based interface. Describe what you're researching in plain language; the AI extracts search parameters, expands queries, and retrieves from OpenAlex.

**Three-Layer Funnel**

| Layer | Tab | What it does |
|-------|-----|-------------|
| Trunk | 🔭 Main Retrieval | AI-decomposed multi-query search with BGE reranking |
| Branch | 🔬 Branch Analysis | Methodology verification via full-text degradation chain |
| Network | 🕸️ Network Graph | Citation-based discovery (backward tracing + forward tracking) |
| Skeleton | 📦 Skeleton Cart | 20-paper collection with AI diagnosis and BibTeX export |

**Skeleton Cart** — A 20-paper collection divided into Foundation (5), Mainstream (10), and Frontier (5). AI suggests categorization when adding papers, and diagnoses structural gaps.

**Branch Analysis** — Three modes to verify your skeleton papers' methodology:
- Probe matching: check if papers use a specific technique
- AI probe suggestion: let AI discover common methods
- Landscape scan: extract methodology from every paper

Text degradation chain: HTML full text → LLM recall → abstract (PDF support planned).

**Network Graph** — ECharts force-directed visualization of citation relationships. Backward tracing finds commonly-cited foundation papers you may have missed. Forward tracking finds recent work citing your skeleton.

## Tech Stack

- **Frontend**: Streamlit
- **Database**: MySQL + SQLAlchemy
- **Search**: OpenAlex API
- **Reranker**: BGE (BAAI/bge-reranker-base) with ONNX Runtime
- **LLM**: DeepSeek / Kimi / OpenAI (configurable)
- **Visualization**: ECharts

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Configure (edit .env)
# MYSQL_URL, LLM_API_KEY, LLM_BASE_URL, LLM_MODEL

# Run
streamlit run app.py
```

## How It Works

```
You: "Transformer in wind power forecasting, recent 5 years"
                    │
        ┌───────────┴───────────┐
        ▼                       │
  AI decomposes into            │
  8 query groups                │
  (methodology × domain)        │
        │                       │
        ▼                       │
  OpenAlex retrieval            │
  (~300 candidates)             │
        │                       │
        ▼                       │
  BGE reranker                  │
  (→ top 100)                   │
        │                       │
        ▼                       │
  You browse, add to skeleton ◄─┘
        │
  ┌─────┴─────┐
  ▼           ▼
Branch      Network
(verify     (discover
 method)    citations)
  │           │
  └─────┬─────┘
        ▼
  20-paper skeleton
  ready for review
```

## Project Structure

```
litfunnel/
├── app.py                  # Streamlit entry point
├── agents/
│   ├── branch.py           # Branch analysis service
│   └── network.py          # Network graph service
├── retrieval/
│   ├── pipeline.py         # Trunk search pipeline
│   ├── decomposer.py       # LLM query decomposition
│   ├── lexical.py          # OpenAlex concurrent search
│   ├── reranker.py         # BGE reranker (ONNX)
│   └── scorer.py           # Relevance scoring
├── sources/
│   └── openalex.py         # OpenAlex API wrapper
├── storage/
│   ├── models.py           # SQLAlchemy models
│   ├── mysql_db.py         # DB connection + migrations
│   └── cart.py             # Skeleton cart service
├── ui/
│   ├── chat.py             # Conversational interface
│   ├── page_trunk.py       # Trunk retrieval tab
│   ├── page_branch.py      # Branch analysis tab
│   ├── page_network.py     # Network graph tab
│   └── page_cart.py        # Skeleton cart tab
├── llm/
│   ├── client.py           # Unified LLM client
│   └── prompts.py          # Prompt templates
└── utils/
    ├── config.py           # Settings + provider config
    └── log.py              # Unified logging
```

## License

MIT
