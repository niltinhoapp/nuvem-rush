#!/usr/bin/env bash
# Empurra todas as variaveis do .env.local para o ambiente de PRODUCAO da Vercel.
# Pre-requisitos: `vercel login` e `vercel link` (projeto ja vinculado).
# Uso: bash scripts/push-env-vercel.sh
set -euo pipefail

ENV_FILE=".env.local"
TARGET="${1:-production}"
# Diretorio de config do Vercel (contorna bug EXDEV no Windows).
GC="${VERCEL_GC:-$HOME/.vercel-cli}"
vc() { npx vercel "$@" --global-config "$GC"; }

[ -f "$ENV_FILE" ] || { echo "Arquivo $ENV_FILE nao encontrado"; exit 1; }

while IFS= read -r line || [ -n "$line" ]; do
  # ignora comentarios e linhas vazias
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  [[ "$line" != *"="* ]] && continue

  name="${line%%=*}"
  value="${line#*=}"
  name="$(echo "$name" | xargs)"            # trim
  # remove aspas duplas externas, se houver
  value="${value%\"}"; value="${value#\"}"

  [ -z "$value" ] && { echo "pulando $name (vazio)"; continue; }

  # idempotente: remove antes de adicionar
  vc env rm "$name" "$TARGET" -y >/dev/null 2>&1 || true
  printf '%s' "$value" | vc env add "$name" "$TARGET" >/dev/null 2>&1
  echo "  ✓ $name"
done < "$ENV_FILE"

echo "Pronto. Variaveis enviadas para o ambiente '$TARGET'."
