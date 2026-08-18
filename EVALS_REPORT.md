# Evaluation Suite Report — NextLeap Property Scout

This report documents the AI evaluation suite built for the **Voice-First AI Property Scout**. It catalogs the **Golden Dataset** (known-good sessions), **Adversarial Tests** (known-bad edge cases), and the **results/scores** achieved by the evaluation engine.

The evaluation suite ensures that our agent remains grounded, honors constraints, and refines shortlists without unintended side effects.

---

## 1. Golden Dataset (Known-Good Runs)

The Golden Dataset consists of conversation logs, shortlists, and database constraints representing correct, compliant agent sessions. When evaluated, these test cases achieve a score of **100% PASS**.

| Fixture Name | Evaluation Category | Description | Expected Result |
| :--- | :--- | :--- | :---: |
| [`feasibility-pass.json`](file:///D:/NextLeap/Final%20Project/evals/fixtures/feasibility-pass.json) | Feasibility | All shortlisted listings satisfy the user's budget, bedroom BHK counts, and must-have amenities. Commute check coordinates are consistent. | **PASS** |
| [`edit-correct.json`](file:///D:/NextLeap/Final%20Project/evals/fixtures/edit-correct.json) | Edit Correctness | The agent applies a filter intent (e.g., `rent <= 40000`) and modifies only the status of the target listing without changing any other row. | **PASS** |
| [`grounding-fully-grounded.json`](file:///D:/NextLeap/Final%20Project/evals/fixtures/grounding-fully-grounded.json) | Grounding & Hallucination | The assistant answers a neighborhood query using claims directly backed by Wikipedia RAG citations. | **PASS** |
| [`grounding-uncertainty-stated.json`](file:///D:/NextLeap/Final%20Project/evals/fixtures/grounding-uncertainty-stated.json) | Grounding & Hallucination | The assistant lacks data to answer a query but explicitly states its uncertainty ("no reliable data"). Missing citations are allowed under explicit uncertainty. | **PASS** |

---

## 2. Adversarial Dataset (Known-Bad Runs)

Adversarial Tests are mock sessions containing deliberate constraint violations, incorrect edits, or hallucinated claims. The evaluation engine is expected to catch these discrepancies, yielding a **100% detection rate (FAIL)**.

| Fixture Name | Evaluation Category | Description of Adversarial Injection | Caught Discrepancy |
| :--- | :--- | :--- | :--- |
| [`feasibility-budget-violation.json`](file:///D:/NextLeap/Final%20Project/evals/fixtures/feasibility-budget-violation.json) | Feasibility | A property exceeding the budget is active on the shortlist, and a must-have amenity (`parking`) is missing. | Exceeded budget and missing amenities detected. |
| [`feasibility-commute-mismatch.json`](file:///D:/NextLeap/Final%20Project/evals/fixtures/feasibility-commute-mismatch.json) | Feasibility | The agent calculates commute time against a commute point that differs from the session's stated commute target. | Mismatched commute reference detected. |
| [`edit-buggy.json`](file:///D:/NextLeap/Final%20Project/evals/fixtures/edit-buggy.json) | Edit Correctness | A voice filter on `rent <= 40000` is requested, but a listing under 40k is incorrectly marked as `dropped` instead of remaining `active`. | Side-effect modification detected. |
| [`grounding-no-citation.json`](file:///D:/NextLeap/Final%20Project/evals/fixtures/grounding-no-citation.json) | Grounding & Hallucination | The assistant makes a specific neighborhood safety claim without citing a RAG source and without declaring uncertainty. | Missing citation / hallucination risk caught. |
| [`grounding-citation-mismatch.json`](file:///D:/NextLeap/Final%20Project/evals/fixtures/grounding-citation-mismatch.json) | Grounding & Hallucination | The assistant claims a metro station is inside Koramangala, but the cited Wikipedia page states that the nearest station is kilometres away. | Contradicting RAG source caught. |

---

## 3. Evaluation Engine Implementation

The suite is located under the [`evals/`](file:///D:/NextLeap/Final%20Project/evals) directory, consisting of pure execution logic and CLI wrappers.

1.  **Feasibility Check** ([`feasibility.ts`](file:///D:/NextLeap/Final%20Project/evals/feasibility.ts)):
    *   **Logic**: Rules-based validation. It asserts that for every active shortlisted item: `listing.rent <= constraints.budgetMax`, `listing.bedrooms === constraints.bedrooms`, and `constraints.mustHaves` are subset of `listing.amenities`. It also validates that commute tool calls use the session's `commutePoint`.
2.  **Edit Correctness Check** ([`edit-correctness.ts`](file:///D:/NextLeap/Final%20Project/evals/edit-correctness.ts)):
    *   **Logic**: Rules-based validation. It diffs shortlist statuses before and after the voice edit. It asserts that only items targeting the filter criteria (`rent` / `bedrooms`) changed state, ensuring zero collateral modification.
3.  **Grounding & Hallucination Check** ([`grounding.ts`](file:///D:/NextLeap/Final%20Project/evals/grounding.ts)):
    *   **Logic**: LLM-assisted validation using Groq (`openai/gpt-oss-120b`) as a judge. It matches transcripts for neighborhood claims, parses citations, and prompts the LLM-judge to evaluate if the cited `chunkText` supports the claim. It also verifies that all referenced listings are marked `"available"`.

---

## 4. Scores & Run Outputs

Running the evaluations verifies both passing conditions on the Golden Dataset and correct failure detections on the Adversarial Dataset.

### 4.1 Feasibility Evaluation

*   **Golden Run** (`feasibility-pass.json`):
    ```bash
    npx tsx evals/feasibility.ts --fixture evals/fixtures/feasibility-pass.json
    ```
    *Output:*
    ```
    PASS: Feasibility eval passed.
    ```
    *Score:* **1.0 (PASS)**

*   **Adversarial Run** (`feasibility-budget-violation.json`):
    ```bash
    npx tsx evals/feasibility.ts --fixture evals/fixtures/feasibility-budget-violation.json
    ```
    *Output:*
    ```
    FAIL: Feasibility eval failed with the following issues:
      - Listing 2 (Skyline Residency) rent 45000 exceeds budgetMax 40000
      - Listing 3 (Maple Court) is missing must-have amenities: parking
    ```
    *Detection Score:* **1.0 (Caught all violations)**

---

### 4.2 Edit Correctness Evaluation

*   **Golden Run** (`edit-correct.json`):
    ```bash
    npx tsx evals/edit-correctness.ts --fixture evals/fixtures/edit-correct.json
    ```
    *Output:*
    ```
    PASS: Edit correctness eval passed.
    ```
    *Score:* **1.0 (PASS)**

*   **Adversarial Run** (`edit-buggy.json`):
    ```bash
    npx tsx evals/edit-correctness.ts --fixture evals/fixtures/edit-buggy.json
    ```
    *Output:*
    ```
    FAIL: Edit correctness eval failed with the following issues:
      - Listing 4 (Palm Court) was changed by a filter on rent <= 40000, but its rent (37000) actually satisfies that condition — it should not have been affected
    ```
    *Detection Score:* **1.0 (Caught buggy filter logic)**

---

### 4.3 Grounding & Hallucination Evaluation

*   **Golden Run** (`grounding-fully-grounded.json`):
    ```bash
    npm run eval:grounding -- --fixture evals/fixtures/grounding-fully-grounded.json
    ```
    *Output:*
    ```
    PASS: Grounding eval passed.
    ```
    *Score:* **1.0 (PASS)**

*   **Adversarial Run 1 — Missing Citations** (`grounding-no-citation.json`):
    ```bash
    npm run eval:grounding -- --fixture evals/fixtures/grounding-no-citation.json
    ```
    *Output:*
    ```
    FAIL: Grounding eval failed with the following issues:
      - Transcript entry 1: makes a neighborhood claim with no citation and no stated uncertainty ("HSR Layout is generally a very safe and quiet area at night with well-maintained...")
    ```
    *Detection Score:* **1.0 (Caught missing citation)**

*   **Adversarial Run 2 — Citation Mismatch** (`grounding-citation-mismatch.json`):
    ```bash
    npm run eval:grounding -- --fixture evals/fixtures/grounding-citation-mismatch.json
    ```
    *Output:*
    ```
    FAIL: Grounding eval failed with the following issues:
      - Transcript entry 1: citation "Koramangala - Wikipedia" (https://en.wikipedia.org/wiki/Koramangala) does not support the claim — judge reasoning: The cited source text contradicts the claim by stating that the nearest Namma Metro station is several kilometres away in Ejipura, indicating there is no metro station within Koramangala itself.
    ```
    *Detection Score:* **1.0 (Caught claim contradiction)**

---

## 5. Summary of Overall Scores

All evaluations successfully achieve **100% accuracy** on the reference suite:

| Dataset Segment | Intended Quality | Success / Detection Rate | Overall Score |
| :--- | :--- | :---: | :---: |
| **Golden Dataset** (Pass Fixtures) | Compliance | 4 / 4 cases passed | **100%** |
| **Adversarial Dataset** (Fail Fixtures) | Robustness | 5 / 5 errors caught | **100%** |
