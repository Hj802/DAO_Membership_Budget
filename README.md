# DAO Budget Vault

블록체인 기반 DAO 회비/예산 집행 MVP입니다. PRD/SRS 기준으로 프론트엔드, API,
스마트컨트랙트, DB 캐시를 나누어 구현합니다.

## 구조

| 경로                 | 역할                            |
| -------------------- | ------------------------------- |
| `apps/web`           | Vite + React 프론트엔드         |
| `apps/api`           | Express + TypeScript API 서버   |
| `packages/contracts` | Hardhat 스마트컨트랙트 프로젝트 |
| `packages/db`        | Prisma DB 스키마와 DB 유틸리티  |
| `packages/shared`    | 공통 상수와 타입                |
| `packages/scripts`   | 개발/검증 보조 스크립트         |

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

## 네트워크 설정

MVP 기본 네트워크는 Sepolia 테스트넷이다.

- Chain ID: `11155111`
- RPC URL: `SEPOLIA_RPC_URL`, `VITE_SEPOLIA_RPC_URL`
- 배포 계정 개인키: `SEPOLIA_PRIVATE_KEY`

실제 개인키와 API 키는 `.env`에만 저장하고 커밋하지 않는다.
