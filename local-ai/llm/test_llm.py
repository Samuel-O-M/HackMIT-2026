#!/usr/bin/env python3
"""Tool-calling smoke test for the local Gemma server.

Stands in for the brain: it sends the same shape of request Luna gets (system
prompt + a subset of the real tools + a participant utterance), runs the
tool-call loop with canned tool results, and checks the model actually drives
the loop instead of answering from memory.

    ./run_server.sh &                      # in another shell
    uv run python test_llm.py              # or: python3 test_llm.py
    python3 test_llm.py --url http://127.0.0.1:5003

Standard library only. Exits non-zero if no tool call or no final answer.
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request

# The real tool schemas live in voice/brain/tools/index.js; these are trimmed
# copies so the test exercises the same names and shapes.
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "health_search",
            "description": "Look up a drug, brand, or class in RxNorm/RxClass. The ONLY source of medical facts.",
            "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_prohibited",
            "description": "Check a resolved drug (by rxcui) against this participant's protocol rules.",
            "parameters": {"type": "object", "properties": {"rxcui": {"type": "string"}}, "required": ["rxcui"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "patient_read",
            "description": "Read a slice of the participant's record.",
            "parameters": {
                "type": "object",
                "properties": {
                    "scope": {"type": "string", "enum": ["profile", "medications", "protocol_rules"]},
                },
                "required": ["scope"],
            },
        },
    },
]

SYSTEM = (
    "You are the planning half of a clinical-trial medication reconciliation agent. "
    "You must NEVER state a drug or class from memory: call health_search. "
    "Never decide whether a drug is prohibited yourself: call check_prohibited. "
    "Keep replies short and spoken."
)
USER = (
    "The participant said: 'I've also been taking a little white pill for my knee, "
    "I think it's ibuprofen, maybe a couple of times a week.' "
    "Work out what it is and whether it is allowed on the trial, using the tools."
)


def fake_execute(name: str, args: dict) -> dict:
    """Canned tool outputs, shaped like the real ones."""
    if name == "health_search":
        return {
            "query": args.get("query"),
            "ingredients": [{"rxcui": "5640", "name": "ibuprofen", "matched_kind": "exact",
                             "classes": [{"class_id": "N02BA01", "name": "NSAID", "type": "ATC"}]}],
            "found_anything": True,
        }
    if name == "check_prohibited":
        return {"rxcui": args.get("rxcui"), "prohibited": True,
                "hits": [{"rule_type": "prohibited_class", "protocol_section": "§6.3.2",
                          "rationale": "NSAIDs excluded during treatment", "class_name": "NSAID"}]}
    if name == "patient_read":
        return {"scope": args.get("scope"),
                "rows": [{"canonical_name": "metformin", "status": "active"}]}
    return {"error": f"no fake executor for {name}"}


def post(url: str, body: dict, timeout: int) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": "Bearer local"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="http://127.0.0.1:5003")
    ap.add_argument("--model", default="gemma-4-e4b")
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--timeout", type=int, default=600, help="seconds per request (CPU is slow)")
    args = ap.parse_args()

    endpoint = args.url.rstrip("/") + "/v1/chat/completions"
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": USER}]
    tool_calls: list[dict] = []
    final_text = ""
    t_start = time.time()

    for rnd in range(args.rounds + 1):
        body = {
            "model": args.model,
            "messages": messages,
            "tools": TOOLS if rnd < args.rounds else [],
            "tool_choice": "auto",
            "max_tokens": 512,
            "temperature": 0.0,
        }
        body = {k: v for k, v in body.items() if not (k == "tools" and not v)}
        t = time.time()
        try:
            data = post(endpoint, body, args.timeout)
        except urllib.error.URLError as err:
            print(f"FAIL: could not reach {endpoint} — {err}\n(start it with ./run_server.sh)")
            return 2
        msg = data.get("choices", [{}])[0].get("message", {})
        dt = time.time() - t
        calls = msg.get("tool_calls") or []
        print(f"  round {rnd + 1}: {dt:5.1f}s  tool_calls={len(calls)}  content={len(msg.get('content') or '')} chars")

        messages.append(msg)
        if not calls:
            final_text = (msg.get("content") or "").strip()
            break
        for c in calls:
            fn = c.get("function", {})
            try:
                a = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                a = {"_parse_error": fn.get("arguments")}
            result = fake_execute(fn.get("name"), a)
            tool_calls.append({"name": fn.get("name"), "args": a, "result": result})
            print(f"      → {fn.get('name')}({json.dumps(a, ensure_ascii=False)})")
            messages.append({"role": "tool", "tool_call_id": c.get("id"), "content": json.dumps(result)})

    print(f"\nelapsed {time.time() - t_start:.1f}s")
    print("final answer:", final_text[:400] or "<none>")
    ok = bool(tool_calls) and bool(final_text)
    print(("\nPASS" if ok else "\nFAIL") + f": {len(tool_calls)} tool call(s), final answer {'yes' if final_text else 'no'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
