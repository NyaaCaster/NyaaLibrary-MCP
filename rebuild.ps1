$ErrorActionPreference = "Stop"
$COMPOSE_FILE = "docker-compose.yml"
$PROJECT = "nyaalibrary-mcp"

# Build the image and run the container locally — no registry tag/push.
# `-p $PROJECT` pins the compose project name so this only ever touches this
# project's container/network, never the other containers on the host.

Write-Host "Stopping containers..." -ForegroundColor Cyan
docker compose -p $PROJECT -f $COMPOSE_FILE down

Write-Host "Building image..." -ForegroundColor Cyan
docker compose -p $PROJECT -f $COMPOSE_FILE build

Write-Host "Removing dangling images..." -ForegroundColor Cyan
$dangling = docker images -f "dangling=true" -q
if ($dangling) { docker rmi -f $dangling }

Write-Host "Starting containers..." -ForegroundColor Cyan
docker compose -p $PROJECT -f $COMPOSE_FILE up -d

Write-Host "Done. Running containers:" -ForegroundColor Green
docker ps --format "table {{.Names}}`t{{.Status}}`t{{.Ports}}"
