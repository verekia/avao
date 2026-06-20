docker buildx build --platform linux/arm64 --load -t verekia/avao .
docker save verekia/avao | gzip > /tmp/avao.tar.gz
scp /tmp/avao.tar.gz midgar:/tmp/
ssh midgar docker load --input /tmp/avao.tar.gz
ssh midgar docker compose up -d avao
