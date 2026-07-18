/**
 * Evaluation Harness — stub.
 *
 * TODO (spec §8): Implement run_eval_suite(contract, goldenSet) before the
 * first agent ships to production:
 *
 *   1. Create golden-set JSONL files in /golden_sets/<agent_name>.jsonl
 *      with 15-30 hand-reviewed (context, rubric) pairs per active agent.
 *
 *   2. Implement run_eval_suite():
 *      - Runs run_agent(contract, example.context) for each example.
 *      - Scores output against example.rubric using an LLM judge
 *        (use a cheap/free judge model — not the same model being evaluated).
 *      - Returns EvalReport { agentName, passRate, results[] }.
 *
 *   3. Add a CI step that runs the eval suite on every prompt or model change.
 *      Deploy gate: block if pass_rate < 0.85 on any active agent's golden set.
 *
 *   4. Pair with a 5%-of-production human spot-check queue to catch drift early.
 *
 * Nothing is implemented here intentionally — the harness must not ship empty
 * golden sets that give a false 100% pass rate.
 */

export {};
