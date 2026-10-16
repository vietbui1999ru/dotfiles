#!/usr/bin/env bash
input=$(cat)
paths=$(jq -r '
  .tool_input as $i |
  [$i.file_path, $i.path, $i.target_path,
   ($i | .. | strings | split("\n")[] |
     select(test("^\\*\\*\\* (Update|Add|Delete|Move to) File: ")) |
     sub("^\\*\\*\\* (Update|Add|Delete|Move to) File: "; ""))]
  | .[]? | select(type == "string" and length > 0)
' <<<"$input" 2>/dev/null)

protected='biome.json biome.jsonc eslint.config.js eslint.config.mjs eslint.config.cjs .eslintrc .eslintrc.js .eslintrc.json .eslintrc.yml .eslintrc.yaml .noslop .golangci.yml .golangci.yaml checkstyle.xml .rubocop.yml detekt.yml .swiftlint.yml phpstan.neon phpmd.xml .luacheckrc .hlint.yaml .credo.exs analysis_options.yaml'
while IFS= read -r path; do
  name=${path##*/}
  for candidate in $protected; do
    if [[ "$name" == "$candidate" ]]; then
      reason="Blocked: '$name' is a protected lint configuration. Edit it manually."
      jq -n --arg reason "$reason" '{"decision":"block","reason":$reason}'
      exit 0
    fi
  done
done <<<"$paths"
