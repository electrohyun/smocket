# 소셜 프리뷰 카드 이어서 하기 (핸드오프)

## 이게 뭔가

smocket 레포의 소셜 프리뷰 이미지(1280x640)를 만드는 중입니다. #116의 마지막 남은 항목입니다. 레포 링크를 슬랙·트위터 등에 붙일 때 뜨는 OG 카드이고, GitHub Settings > General > Social preview 에 손으로 업로드하는 이미지입니다.

## 중요 제약

- 최종 PNG도, 이 `wip-social-card` 폴더도 **main 에 커밋 금지.** 이 브랜치(`wip/social-card-handoff`)는 집컴으로 넘기려는 스크래치라, pull 해서 이어 작업한 뒤 삭제하세요.
- 최종 이미지는 GitHub 설정에서 손으로 업로드합니다. API 로는 안 올라갑니다.

## 지금 상태

- 현재 시안은 `social-v5-current.png` 입니다(이 폴더 안). 랜딩페이지에 맞춘 버전이고, `social-card.mjs` 를 그대로 돌리면 이게 나옵니다.
- `social-v1-dark-rejected.png` 는 처음 만든 다크 버전인데 방향이 안 맞아 버렸습니다. 참고용으로만 둡니다.

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
| 제목 폰트          | system-ui, weight 800   |
| 워드마크·토큰 폰트 | JetBrains Mono          |

## 다음 할 일 (v6)

v5 에 남은 문제 두 가지입니다.

1. 로켓이 커서 위쪽 그레이엄 노즈가 프레임 위로 살짝 잘립니다.
2. 로켓이 오른쪽 배경 토큰(`namespace`, `io.to('room-1')`)과 겹칩니다.

고치는 법. `social-card.mjs` 에서 `.rocket` 의 `width` 를 600 에서 약 520 으로 줄이고 `transform` 을 `translateY(-50%)` 로 두어 로켓 전체가 프레임 안에 들어오게 합니다. 겹치는 오른쪽 토큰 몇 개(`namespace`, `io.to`, `join`)는 필요하면 `tokens` 배열에서 빼세요. `.glow` 의 `width` 도 로켓 크기에 맞춰 줄이면 됩니다.

## 렌더 방법

집컴에서 이 브랜치 pull 한 뒤, 레포 루트에서.

1. 최초 1회. `pnpm exec playwright install chromium`
2. `node wip-social-card/social-card.mjs out.png`
3. `out.png` 확인하고 마음에 들면 GitHub Settings > General > Social preview 에 업로드.

## 에셋

- `assets/rocket.webp` — 투명 s'more 로켓 컷아웃 (원본은 로컬 `Downloads/rocketwebp.webp`)
- `assets/cat.webp` — 선글라스 고양이 스티커 아바타 (원본은 로컬 `Downloads/ket.webp`)

## 카드 밖, 세션 전체 상태 (참고)

- 열린 PR 은 **#157 (contrib.rocks 기여자 이미지)** 하나이고 머지 대기입니다. all-contributors 봇 대신 이걸 채택했습니다.
- **#116 커뮤니티 인프라**는 거의 끝났고 이 소셜 프리뷰만 남았습니다.
- Renovate 설정은 #149·#153·#154 로 끝났고, typescript·node 메이저는 hold 규칙으로 막아뒀습니다.
- 다음에 잡을 만한 이슈는 **#143 (Node 범위 정하기)**, **#115 (ADR 0016)** 정도입니다.
