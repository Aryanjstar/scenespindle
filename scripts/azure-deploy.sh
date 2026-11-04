#!/usr/bin/env bash
# Build a new image in Azure Container Registry and roll it out to the web and worker apps.
# Usage: scripts/azure-deploy.sh [tag]
# Needs: az login, and the resources created in HANDOFF.md section 4 (rg-scenespindle).
set -euo pipefail
RG="${RG:-rg-scenespindle}"
ACR="${ACR:-$(az acr list -g "$RG" --query "[0].name" -o tsv)}"
TAG="${1:-$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M)}"
IMAGE="$ACR.azurecr.io/scenespindle:$TAG"

echo "Building $IMAGE (the build renders a test film and fails if the renderer is broken)"
az acr build -r "$ACR" -t "scenespindle:$TAG" --platform linux/amd64 .

for app in scenespindle scenespindle-worker; do
  echo "Rolling out $app"
  az containerapp update -n "$app" -g "$RG" --image "$IMAGE" --set-env-vars "APP_VERSION=$TAG" -o none
done

FQDN="$(az containerapp show -n scenespindle -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)"
echo "Health:"
curl -fsS "https://$FQDN/api/health" && echo
