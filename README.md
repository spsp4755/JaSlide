# JaSlide

폐쇄망에서 운영할 수 있는 AI 프레젠테이션 생성 서비스입니다. 사내 OpenAI 호환 LLM, Ollama, vLLM을 사용해 내용을 만들고 HTML 레이아웃 템플릿을 적용한 PPTX/PDF를 내보냅니다.

## 주요 기능

- 로컬 계정 로그인과 Keycloak SSO, 관리자 역할
- PostgreSQL 사용자·발표·템플릿 관리 및 Redis 기반 생성 작업 큐
- 사내 OpenAI 호환 LLM/Ollama/vLLM 모델 등록과 연결 테스트
- 예시 PPTX에서 색상, 한글 글꼴, 텍스트 위치·크기·정렬 추출
- 한국어 Noto 폰트가 포함된 PPTX/PDF/미리보기 렌더링
- 로컬 업로드 자산의 영속 저장과 Docker 볼륨 운영

## 빠른 시작

```powershell
Copy-Item .env.example .env
# .env의 POSTGRES_PASSWORD, JWT_SECRET, OPENAI_BASE_URL, OPENAI_MODEL을 설정
docker compose --env-file .env build
docker compose --env-file .env up -d
```

웹은 `http://localhost:3000`, API 상태 확인은 `http://localhost:4000/api/health`입니다.

## 사내 LLM 설정

관리자 화면에서 모델을 등록한 뒤 **연결 테스트**를 실행합니다.

- Ollama: `http://<host>:11434/v1`
- vLLM/OpenAI 호환 서버: `http://<host>:8000/v1`
- 모델 ID는 사내 서버에 배포된 모델 이름을 입력합니다.

DB 모델을 등록하지 않는 단일 서버 구성은 `.env`의 `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_API_KEY`만으로도 동작합니다.

## 예시 PPTX 템플릿

관리자 템플릿 화면에서 PPTX를 가져오면 텍스트·이미지는 저장하지 않고 시각 토큰과 레이아웃만 추출합니다. 이후 생성된 발표에 해당 템플릿을 선택하면 PPTX/PDF 출력에 적용됩니다.

## 인증

기본은 자체 DB 계정입니다. Keycloak을 함께 쓰려면 `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`, `KEYCLOAK_REDIRECT_URI`를 설정합니다. Keycloak 관리자 역할은 `KEYCLOAK_ADMIN_ROLES`에 지정합니다.

상세 배포 절차는 [docs/deployment.md](docs/deployment.md)를 참고하세요.
