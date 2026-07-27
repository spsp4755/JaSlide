# 덱 글꼴

여기에 글꼴 파일(`.ttf` / `.otf` / `.woff2`)을 넣고 아래를 실행하세요.

```bash
node scripts/install-fonts.mjs
```

그러면 세 가지가 한 번에 처리됩니다.

- **브라우저용** — WOFF2로 변환해 `apps/web/public/fonts/`에 넣고, `@font-face` 규칙을
  `apps/web/src/app/deck-fonts.css`에 생성합니다.
- **렌더러용** — 원본 파일을 `docker/fonts/`에 복사합니다. 이미지 안
  `/usr/share/fonts/truetype/jaslide/`로 들어가 LibreOffice와 Chromium이 씁니다.
- **글꼴 목록** — `apps/web/src/lib/deck-fonts.ts`에 등록되어 편집기 글꼴 선택창에 나옵니다.

변환 후 렌더러를 다시 빌드해야 미리보기와 내보내기에 반영됩니다.

```bash
docker compose up -d --build renderer
```

## 왜 두 군데에 넣나

편집 화면은 브라우저가 그리고, 미리보기·PDF·PPTX는 렌더러 안의 LibreOffice와 Chromium이
그립니다. 한쪽에만 글꼴이 있으면 화면과 내보낸 파일의 글꼴이 서로 달라집니다.

## 왜 TTF를 그대로 안 쓰나

Chromium은 웹폰트를 자체 검사기에 통과시키고, 멀쩡해 보이는 TTF도 거부하는 경우가 있습니다
(데비안 NanumGothic이 그랬습니다 — 4.7MB를 다 받고 나서 "Invalid font data"). WOFF2로 다시
빌드하면 통과하고, 한글 글꼴 기준 용량도 3분의 1로 줄어듭니다.

## 한글 이름

PPTX는 글꼴을 `나눔고딕`처럼 한글 이름으로 지정합니다. 스크립트가 글꼴 파일의 name 테이블에서
언어별 이름을 직접 읽어 `@font-face`를 모두 만들어 주므로, 사내 한글 글꼴도 따로 설정할 게
없습니다.

## 라이선스 주의

이 폴더의 글꼴 **파일 자체는 git에 올라가지 않습니다**(`.gitignore` 참고). 사내 전용이거나
재배포가 제한된 글꼴을 원격 저장소에 올리지 않기 위해서입니다. 폐쇄망 서버에서는 파일을 직접
복사한 뒤 위 스크립트를 실행하세요.

재배포가 허용된 글꼴을 저장소에 포함하려면 해당 파일을 `.gitignore`에서 예외 처리하고
라이선스 파일도 함께 넣으세요. 지금 들어 있는 나눔고딕이 그 예입니다 — OFL-1.1이라
`apps/web/public/fonts/LICENSE-nanum.txt`와 함께 배포합니다.
