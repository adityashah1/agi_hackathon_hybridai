# Hosted demo on AWS (CloudFront → API Gateway → Lambda, plus S3)

The panel runs as a Next.js standalone server inside a Lambda container image, reached through an
API Gateway HTTP API; the sandbox apps are static files in S3. One CloudFront distribution fronts
both, so the suite's `{MOCK_BASE}` resolves to a public address the Sai cloud computer can reach.

| Piece | Resource (us-east-1, account 383845656169) |
|---|---|
| Public URL | `https://d2mtp1n5q1cktr.cloudfront.net/` (distribution `E74RXKVEPETEE`) |
| Sandbox apps | `https://d2mtp1n5q1cktr.cloudfront.net/apps/` → S3 `hybrid-gate-mock-apps-383845656169` (prefix `apps/`, OAC `E2WPZRM30DWE4`, CloudFront Function `hybrid-gate-mock-index` adds `index.html`) |
| Panel | Lambda `hybrid-gate-panel` (arm64, 2048 MB, 60 s) from ECR `hybrid-gate-panel:lambda`; role `hybrid-gate-panel-lambda`; HTTP API `5584ug7nse` (`https://5584ug7nse.execute-api.us-east-1.amazonaws.com`, `$default` route, payload v2) |
| Lambda env | `MOCK_BASE=https://d2mtp1n5q1cktr.cloudfront.net/apps`, `PANEL_READ_ONLY=1`, `RUNS_DIR=/tmp/runs`, `REPO_ROOT=/app/repo` |

Everything is tagged `Project=hybrid-gate`. App Runner was the first choice (always warm) but this
account cannot create App Runner services, so the amd64 image `hybrid-gate-panel:latest` and the
plain `Dockerfile` are kept for an account that can. A Lambda Function URL was tried and removed:
anonymous URLs now need an unconditioned `lambda:InvokeFunction` grant to `*`, which API Gateway
avoids with a grant scoped to the API's ARN.

## What the hosted copy can and cannot do

- Every screen works on the sample run; the overview reads `tasks/tasks.yaml` from the image and
  links the sandbox apps at `/apps/…`. The backend status strip reports the truth: no Python, no
  runner, no Ollama, no Sai key; sandbox apps reachable.
- `PANEL_READ_ONLY=1`: `/api/jobs` has no auth and could otherwise launch model jobs or Sai
  tasks, so on the hosted copy `POST /api/jobs`, `POST /api/runs` (upload) and `POST /api/spec`
  answer 403 with a plain message, the Benchmarks buttons are disabled with that reason, and the
  status strip shows a "Read-only hosted copy" chip. Lambda's filesystem would be read-only except
  `/tmp` anyway. Request and response bodies are capped at 6 MB (Lambda) and the API Gateway
  integration times out at 30 s. The first request after a few idle minutes takes 2–3 s (cold
  start).
- The default cache behavior does not cache, so the panel is always fresh. `/_next/static/*` and
  `/apps/*` are cached; after re-syncing the sandbox apps, invalidate `/apps/*`.

## Redeploy

```bash
# panel image (needs Docker running, AWS CLI configured, from the repo root)
DOCKERFILE=frontend/deploy/aws/Dockerfile.lambda PLATFORM=linux/arm64 \
  IMAGE=383845656169.dkr.ecr.us-east-1.amazonaws.com/hybrid-gate-panel:lambda \
  frontend/deploy/aws/build-image.sh
aws lambda update-function-code --function-name hybrid-gate-panel \
  --image-uri 383845656169.dkr.ecr.us-east-1.amazonaws.com/hybrid-gate-panel:lambda
aws lambda wait function-updated-v2 --function-name hybrid-gate-panel

# sandbox apps
aws s3 sync mock_apps s3://hybrid-gate-mock-apps-383845656169/apps/ \
  --exclude "*.py" --exclude "__pycache__/*" --exclude "README.md" --delete
aws cloudfront create-invalidation --distribution-id E74RXKVEPETEE --paths "/apps/*"
```

`build-image.sh` runs `pnpm --filter panel build` (standalone output, set in `next.config.ts`),
stages `.next/standalone`, `.next/static`, `public/`, `tasks/tasks.yaml`, `runner/schema.py` and
`mock_apps/` next to the Dockerfile, logs in to ECR and runs `docker buildx build --push`.
`Dockerfile.lambda` adds the Lambda Web Adapter; `Dockerfile` is the plain server for App Runner
or any container host (`docker run -p 3000:3000 -e MOCK_BASE=… <image>`).

## How it was created

```bash
aws ecr create-repository --repository-name hybrid-gate-panel
aws iam create-role --role-name hybrid-gate-panel-lambda --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name hybrid-gate-panel-lambda --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws lambda create-function --function-name hybrid-gate-panel --package-type Image --code ImageUri=…:lambda --role arn:aws:iam::383845656169:role/hybrid-gate-panel-lambda --architectures arm64 --memory-size 2048 --timeout 60
API_ID=$(aws apigatewayv2 create-api --name hybrid-gate-panel --protocol-type HTTP --query ApiId --output text)
INT=$(aws apigatewayv2 create-integration --api-id $API_ID --integration-type AWS_PROXY --integration-uri arn:aws:lambda:us-east-1:383845656169:function:hybrid-gate-panel --payload-format-version 2.0 --query IntegrationId --output text)
aws apigatewayv2 create-route --api-id $API_ID --route-key '$default' --target integrations/$INT
aws apigatewayv2 create-stage --api-id $API_ID --stage-name '$default' --auto-deploy
aws lambda add-permission --function-name hybrid-gate-panel --statement-id apigw-invoke --action lambda:InvokeFunction --principal apigateway.amazonaws.com --source-arn "arn:aws:execute-api:us-east-1:383845656169:$API_ID/*/*"
aws s3api create-bucket --bucket hybrid-gate-mock-apps-383845656169   # + public access block, sync mock_apps to apps/
aws cloudfront create-function --name hybrid-gate-mock-index --function-config Comment=…,Runtime=cloudfront-js-2.0 --function-code fileb://cf-index.js   # then publish-function
aws cloudfront create-origin-access-control --origin-access-control-config Name=hybrid-gate-mock-apps-oac,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3
aws cloudfront create-distribution --distribution-config file://cf-dist.json   # default → API Gateway (CachingDisabled, AllViewerExceptHostHeader, all methods); /_next/static/* cached; /apps/* → S3 via OAC + index function
aws s3api put-bucket-policy --bucket hybrid-gate-mock-apps-383845656169 --policy '…cloudfront.amazonaws.com, AWS:SourceArn = distribution ARN…'
aws lambda update-function-configuration --function-name hybrid-gate-panel --environment 'Variables={MOCK_BASE=https://d2mtp1n5q1cktr.cloudfront.net/mock,PANEL_READ_ONLY=1}'
```

The CloudFront Function:

```js
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (!uri.split('/').pop().includes('.')) {
    request.uri = uri + '/index.html';
  }
  return request;
}
```

## Tear down

```bash
aws cloudfront get-distribution-config --id E74RXKVEPETEE > dist.json   # set Enabled=false, update-distribution with the ETag, wait, then:
aws cloudfront delete-distribution --id E74RXKVEPETEE --if-match <etag>
aws cloudfront delete-function --name hybrid-gate-mock-index --if-match <etag>
aws cloudfront delete-origin-access-control --id E2WPZRM30DWE4 --if-match <etag>
aws apigatewayv2 delete-api --api-id 5584ug7nse
aws lambda delete-function --function-name hybrid-gate-panel
aws iam detach-role-policy --role-name hybrid-gate-panel-lambda --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam delete-role --role-name hybrid-gate-panel-lambda
aws s3 rm s3://hybrid-gate-mock-apps-383845656169 --recursive && aws s3api delete-bucket --bucket hybrid-gate-mock-apps-383845656169
aws ecr delete-repository --repository-name hybrid-gate-panel --force
```

Idle cost is near zero (Lambda, API Gateway and CloudFront are pay-per-request; ECR storage is cents).
