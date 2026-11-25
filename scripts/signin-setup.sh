#!/usr/bin/env bash
# Set up the social ways in: write the client ids into wrangler.jsonc and put
# the secrets on both Workers.
#
# Each value comes from an environment variable of its own name, or is asked
# for at the terminal (a secret is not echoed as it is typed). A value left
# empty sets nothing for it. With --dry-run nothing is written anywhere.
#
#   bash scripts/signin-setup.sh
#   GOOGLE_CLIENT_SECRET=… bash scripts/signin-setup.sh
#
# Where each comes from, after the applications are created:
#   GOOGLE_CLIENT_SECRET            one Google project serves both addresses
#   GITHUB_CLIENT_ID                the application whose return address is oulipo.party
#   GITHUB_CLIENT_SECRET            its secret
#   GITHUB_STAGING_CLIENT_ID        the application whose return address is staging.oulipo.party
#   GITHUB_STAGING_CLIENT_SECRET    its secret
#   DISCORD_CLIENT_ID               one Discord application serves both addresses
#   DISCORD_CLIENT_SECRET           its secret
set -euo pipefail
cd "$(dirname "$0")/.."

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1
WRANGLER=(pnpm exec wrangler)

# ask NAME [secret]: read a value that was not given, without echoing a secret.
ask() {
    local name="$1" kind="${2:-}" value=""
    [ -n "${!name:-}" ] && return 0
    if [ "$DRY" = 1 ]; then
        printf -v "$name" ''
        return 0
    fi
    # No answer (an empty line, or nothing to read) leaves the value empty,
    # and so sets nothing for it.
    if [ "$kind" = secret ]; then
        read -r -s -p "$name: " value >&2 || value=''
        echo >&2
    else
        read -r -p "$name: " value || value=''
    fi
    printf -v "$name" '%s' "$value"
}

ask GOOGLE_CLIENT_SECRET secret
ask GITHUB_CLIENT_ID
ask GITHUB_CLIENT_SECRET secret
ask GITHUB_STAGING_CLIENT_ID
ask GITHUB_STAGING_CLIENT_SECRET secret
ask DISCORD_CLIENT_ID
ask DISCORD_CLIENT_SECRET secret

# put NAME VALUE [env]: one secret on one Worker, or on both without an env.
put() {
    local name="$1" value="$2" env="${3:-}"
    local -a flag=()
    [ -n "$env" ] && flag=(--env "$env")
    echo "  wrangler secret put $name ${flag[*]}"
    [ "$DRY" = 1 ] && return 0
    printf '%s' "$value" | "${WRANGLER[@]}" secret put "$name" "${flag[@]}" > /dev/null
}

echo "Client ids into wrangler.jsonc:"
echo "  GITHUB_CLIENT_ID: ${GITHUB_CLIENT_ID:-<left as it is>}"
echo "  GITHUB_CLIENT_ID (staging): ${GITHUB_STAGING_CLIENT_ID:-<left as it is>}"
echo "  DISCORD_CLIENT_ID: ${DISCORD_CLIENT_ID:-<left as it is>}"
if [ "$DRY" = 0 ]; then
    node scripts/write-client-ids.mjs wrangler.jsonc "$GITHUB_CLIENT_ID" "$GITHUB_STAGING_CLIENT_ID" "$DISCORD_CLIENT_ID"
fi

echo "Secrets:"
[ -n "$GOOGLE_CLIENT_SECRET" ] && { put GOOGLE_CLIENT_SECRET "$GOOGLE_CLIENT_SECRET" staging; put GOOGLE_CLIENT_SECRET "$GOOGLE_CLIENT_SECRET"; }
[ -n "$GITHUB_CLIENT_SECRET" ] && put GITHUB_CLIENT_SECRET "$GITHUB_CLIENT_SECRET"
[ -n "$GITHUB_STAGING_CLIENT_SECRET" ] && put GITHUB_CLIENT_SECRET "$GITHUB_STAGING_CLIENT_SECRET" staging
[ -n "$DISCORD_CLIENT_SECRET" ] && { put DISCORD_CLIENT_SECRET "$DISCORD_CLIENT_SECRET" staging; put DISCORD_CLIENT_SECRET "$DISCORD_CLIENT_SECRET"; }

if [ "$DRY" = 1 ]; then
    echo "(dry run: nothing was written)"
    exit 0
fi
cat <<'NEXT'

Done. To put it on staging:
  git commit -am "chore: sign-in providers" && pnpm exec wrangler deploy --env staging
NEXT
