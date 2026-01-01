#!/bin/bash
# Post-install script to substitute {{name}} with project name

NAME=$(basename "$PWD")

# Substitute in all files that contain {{name}}
for file in compose.yml .env.example package.json server/package.json client/package.json README.md; do
  if [ -f "$file" ]; then
    sed -i.bak "s/{{name}}/$NAME/g" "$file"
    rm -f "$file.bak"
  fi
done

# Copy .env.example to .env
cp .env.example .env

echo "Project '$NAME' configured successfully!"
