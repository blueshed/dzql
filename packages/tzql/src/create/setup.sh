#!/bin/bash
# Replace {{name}} with project name from package.json
NAME=$(grep -o '"name": *"[^"]*"' package.json | head -1 | cut -d'"' -f4)
if [ -z "$NAME" ] || [ "$NAME" = "{{name}}" ]; then
  NAME=$(basename "$PWD")
fi
sed -i.bak "s/{{name}}/$NAME/g" compose.yml .env.example README.md package.json 2>/dev/null || \
sed -i "s/{{name}}/$NAME/g" compose.yml .env.example README.md package.json
cp .env.example .env
rm -f compose.yml.bak .env.example.bak README.md.bak package.json.bak
echo "✓ Configured project: $NAME"
