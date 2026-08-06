# 소셜 프리뷰 카드 이어서 하기 (핸드오프)

## 이게 뭔가

smocket 레포의 소셜 프리뷰 이미지(1280x640)를 만드는 중입니다. #116의 마지막 남은 항목입니다. 레포 링크를 슬랙·트위터 등에 붙일 때 뜨는 OG 카드이고, GitHub Settings > General > Social preview 에 손으로 업로드하는 이미지입니다.

## 중요 제약

- 최종 PNG도, 이 `wip-social-card` 폴더도 **main 에 커밋 금지.** 이 브랜치(`wip/social-card-handoff`)는 집컴으로 넘기려는 스크래치라, pull 해서 이어 작업한 뒤 삭제하세요.
- 최종 이미지는 GitHub 설정에서 손으로 업로드합니다. API 로는 안 올라갑니다.

## 지금 상태

**확정됐습니다. 최종본은 `social-final.png` 이고, `social-card.mjs` 를 그대로 돌리면 이게 나옵니다.** 남은 일은 GitHub 설정에 손으로 업로드하는 것뿐입니다.

시안 흐름은 `renders/` 안에 남겨뒀습니다.

- `social-v1-dark-rejected.png` — 다크. 방향이 안 맞아 버렸습니다.
- `renders/social-v2.png` — 배경 있는 png 를 쓰던 때. 노즈가 허옇게 뜨고 위가 잘리고, 제목 뒤에 토큰이 깔립니다.
- `renders/social-v3.png` — 로켓을 줄여 프레임에 넣었으나 배경 png 의 사각형 이음매가 그대로 보입니다.
- `renders/social-v4.png` — 투명 컷아웃으로 갈아타 이음매가 사라졌습니다. 구도가 여기서 잡혔습니다.
- `social-v5-current.png` — v4 에서 로켓을 600 으로 키우다 노즈가 잘리고 토큰이 겹쳤습니다. 후퇴한 버전입니다.
- `renders/social-v6.png` — v5 의 두 문제만 고친 것. 로켓이 아직 커서 여백이 부족합니다.
- `renders/social-v7.png` — v4 지오메트리로 복귀. 로켓 380 / `right:120`, 글로우 480 / `right:64`.
- `renders/social-v8.png` — 토큰을 6 개에서 14 개로 늘리고 진하게. 제목 굵기는 안 먹었습니다(아래 폰트 항목 참고).
- `renders/social-v9.png` — Inter 도입. weight 900 은 과했습니다.
- `renders/social-v10-w800.png`, `renders/social-v10-w700.png` — 굵기 비교용. **700 채택.**

## 방향 (되짚기)

- 다크(v1) 버리고 **랜딩페이지(밝은 크림) 매칭**으로 갑니다.
- **로켓이 히어로이자 아이콘**(오른쪽 크게), **고양이는 워드마크 옆 작은 아바타**입니다. 랜딩과 같은 구성입니다.
- 로켓은 **투명 컷아웃 `assets/rocket.webp`** 를 씁니다. 예전에 배경 있는 png 를 쓰다 배경색 맞추는 꼼수가 필요했는데, 투명본으로 바꿔서 그게 없어졌습니다.

## 브랜드 값 (랜딩에서 실측)

| 항목               | 값                      |
| ------------------ | ----------------------- |
| 배경 크림          | `#f5ecdb`               |
| 텍스트 진브라운    | `#241608`               |
| 오렌지 포인트      | `#f4a259`               |
| 흐린 코드 토큰     | `#cf9a55`               |
| 제목 폰트          | Inter, weight 700       |
| 워드마크·토큰 폰트 | JetBrains Mono          |

제목 폰트는 원래 랜딩과 같이 system-ui 였는데 **Inter 웹폰트로 바꿨습니다.** headless Chromium 이 system-ui 를 단일 face 로만 잡아서, weight 를 400 으로 두든 900 으로 두든 폭이 1264px 로 똑같이 나옵니다. 굵기 지정이 아예 안 먹고 렌더하는 컴마다 제목 모양이 달라집니다. Inter 를 구글 폰트에서 불러오면 굵기가 실제로 먹고 어느 컴에서 돌려도 결과가 같습니다. 랜딩은 여전히 system-ui 이므로 카드와 사이트의 제목 서체가 미세하게 다릅니다. 맞추려면 랜딩 쪽(별도 레포)도 Inter 로 옮겨야 합니다.

## 남은 일

**GitHub Settings > General > Social preview 에 `social-final.png` 를 손으로 업로드하면 끝입니다.** 그러고 나서 이 브랜치를 삭제하세요.

파일은 2560x1280(2배 렌더), 0.69MB 입니다. GitHub 업로드 제한 1MB 안에 들어옵니다.

## 렌더 방법

집컴에서 이 브랜치 pull 한 뒤, 레포 루트에서.

1. 최초 1회. `pnpm exec playwright install chromium`
2. `node wip-social-card/social-card.mjs out.png`
3. `out.png` 확인하고 마음에 들면 GitHub Settings > General > Social preview 에 업로드.

## 에셋

- `assets/rocket.webp` — 투명 s'more 로켓 컷아웃 (원본은 로컬 `Downloads/rocketwebp.webp`)
- `assets/cat.webp` — 선글라스 고양이 스티커 아바타 (원본은 로컬 `Downloads/ket.webp`)

## 카드 밖, 세션 전체 상태 (참고)

- #157 은 머지됐고, 열린 PR 은 없습니다.
- **#116 커뮤니티 인프라**는 이 소셜 프리뷰 업로드로 닫힙니다.
- Renovate 설정은 #149·#153·#154 로 끝났고, typescript·node 메이저는 hold 규칙으로 막아뒀습니다.
- **main 에 버그가 하나 있습니다.** `package.json` 의 `packageManager` 는 `pnpm@11.19.0` 인데 `devEngines.packageManager` 는 `11.15.1` 로 남아 있어, 두 값이 어긋나 `pnpm exec ...` 가 거부됩니다. #150 이 한쪽만 올려서 생겼습니다. 임시로는 `pnpm --pm-on-fail=ignore exec ...` 로 우회합니다.
- 다음에 잡을 만한 이슈는 **#143 (Node 범위 정하기)**, **#115 (ADR 0016)** 정도입니다.
