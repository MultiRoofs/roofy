#!/usr/bin/env bash
# usage: codex-retry.sh PROMPT OUT ERR — up to 3 attempts, 300 s apart, on empty output
prompt=$1; out=$2; err=$3
for attempt in 1 2 3; do
  timeout 2400 codex exec -m gpt-6-astra --skip-git-repo-check -s read-only 'Follow the piped review instructions exactly; read the files they name by path, in chunks.' < "$prompt" > "$out" 2> "$err"
  code=$?
  if [ -s "$out" ] && [ "$code" = "0" ]; then echo "codex exit=$code attempt=$attempt" >> "$err"; exit 0; fi
  echo "attempt $attempt failed (exit=$code, bytes=$(wc -c < "$out"))" >> "$err.attempts"
  sleep 300
done
echo "codex exit=$code attempts=3 FAILED" >> "$err"
exit 1
