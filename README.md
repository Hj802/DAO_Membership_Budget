# DAO Budget Vault

블록체인 기반 DAO 회비/예산 집행 MVP입니다. PRD/SRS 기준으로 프론트엔드, Cloudflare API,
스마트컨트랙트, DB 캐시, R2 증빙 저장소를 나누어 구현합니다.

## 구조

| 경로                 | 역할                                                |
| -------------------- | --------------------------------------------------- |
| `apps/web`           | Vite + React 프론트엔드, Cloudflare Pages 배포 대상 |
| `apps/api`           | Workers 호환 TypeScript API handler                 |
| `packages/contracts` | Hardhat 스마트컨트랙트 프로젝트                     |
| `packages/db`        | Prisma DB 스키마와 DB 유틸리티                      |
| `packages/shared`    | 공통 상수와 타입                                    |
| `packages/scripts`   | 개발/검증 보조 스크립트                             |

## 시작

1. 의존성을 설치한다.

```bash
npm install
```

2. 환경 변수 예시를 복사하고 값은 로컬에서만 채운다.

```bash
cp .env.example .env
```

3. 기본 검증 명령을 실행한다.

```bash
npm run validate:env
npm run build
npm run lint
npm test
```

## 개발 명령

```bash
npm run dev:web
npm run dev:api
npm run build
npm run lint
npm run format
npm test
```

`apps/api`는 Cloudflare Workers/Pages Functions 런타임을 기준으로 `fetch(Request)` handler를 제공한다.
로컬 개발 명령은 같은 handler를 Node HTTP 서버로 감싸 실행한다.

## 네트워크 설정

MVP 기본 네트워크는 Sepolia 테스트넷이다.

- Chain ID: `11155111`
- RPC URL: `SEPOLIA_RPC_URL`, `VITE_SEPOLIA_RPC_URL`
- 컨트랙트 주소: `VITE_FACTORY_ADDRESS`, `FACTORY_ADDRESS`

## Cloudflare 기준 설정

- Frontend: `apps/web/wrangler.toml` 기준으로 Cloudflare Pages에 `dist`를 배포한다.
- API: `apps/api/wrangler.toml` 기준으로 Workers 또는 Pages Functions 호환 handler를 배포한다.
- DB binding: `DAO_BUDGET_DB`
- R2 binding: `DAO_BUDGET_EVIDENCE_BUCKET`
- 이벤트 동기화: Workers Cron entrypoint를 Phase 8에서 구현한다.

`SEPOLIA_PRIVATE_KEY`는 컨트랙트 배포용 값이다. API Worker 런타임에는 설정하지 않는다.

실제 개인키와 API 키는 `.env`에만 저장하고 커밋하지 않는다.
