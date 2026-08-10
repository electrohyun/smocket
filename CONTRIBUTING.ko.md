# smocket 기여 가이드

시간을 내어 기여해 주셔서 감사합니다.

smocket은 Socket.IO의 전달(delivery)·라우팅 계층을 최대한 그대로 재현하는 것을 목표로 합니다. 변경을 제안하실 때는 해당 상황에서 실제 Socket.IO가 어떻게 동작하는지도 함께 알려주시면 큰 도움이 됩니다. smocket과 Socket.IO의 동작이 다르다면, 항상 Socket.IO 쪽을 기준으로 삼습니다.

## 시작하기

smocket은 [pnpm](https://pnpm.io)을 사용합니다.

```bash
git clone https://github.com/electrohyun/smocket.git
cd smocket
pnpm install
pnpm test
```

`pnpm test`는 Vitest를 watch 모드로 돌리는 명령이라, 작업하는 동안 켜 두면 편합니다. 따로 확인할 개발 서버가 없다 보니, 테스트 출력 자체가 곧 피드백 루프인 셈입니다.

| 명령어             | 설명                        |
| ----------------- | ------------------------------ |
| `pnpm test`       | 테스트를 watch 모드로 실행      |
| `pnpm test --run` | 테스트를 한 번만 실행           |
| `pnpm typecheck`  | 결과물을 만들지 않고 타입만 검사 |

Vitest는 어디까지나 개발 의존성일 뿐입니다. `src/` 어디에서도 import되지 않고, smocket을 설치한다고 해서 딸려 들어오지도 않습니다. spy나 fake timer가 필요한 헬퍼를 추가하게 되면, `vitest`에서 가져다 쓰는 대신 직접 구현해야 이 경계가 유지됩니다.

## 다루는 범위

smocket이 재현하는 건 전달·라우팅 계층입니다 — 즉 어떤 소켓이 특정 이벤트를 받는지, 그리고 왜 받는지가 핵심입니다. 지금 계획상 다음 항목들은 이 범위 밖에 있습니다.

- 재연결(Reconnection)
- 트랜스포트 폴백
- 하트비트
- Redis 어댑터를 통한 멀티 서버 구성
- 바이너리 인코딩

떠오른 아이디어가 이 범위에 맞는지 애매하다면, 코드부터 쓰지 마시고 이슈를 먼저 열어 주세요. 어디까지 다룰 수 있을지는 함께 이야기하며 정하면 됩니다.

## 어디서부터 시작하면 좋을까

`good first issue` 라벨이 붙은 이슈는 코드베이스 전체를 몰라도 끝낼 수 있을 만큼 범위를 좁혀 둔 것들입니다. `help wanted`는 중요하긴 한데 아직 아무도 손대고 있지 않은 작업에 붙는 라벨이고요.

테스트, 툴링, CI, 리팩토링 — 이런 작업도 모두 환영합니다. 이럴 땐 Maintenance 이슈 템플릿을 사용해 주세요.

## Branches

작업은 `main`에서 갈라져 나온, 오래 살지 않는 브랜치 위에서 이루어집니다. `develop` 브랜치는 따로 두지 않습니다.

브랜치 이름은 작업의 커밋 타입을 그대로 따릅니다.

```
feat/room-join
fix/disconnect-cleanup
test/broadcast-exclusion
docs/usage-examples
chore/ci-typecheck
```

이슈가 이미 있다면 `gh issue develop <number> --checkout` 한 줄로 브랜치 생성과 체크아웃을 동시에 끝낼 수 있습니다.

## commit

smocket은 [Conventional Commits](https://www.conventionalcommits.org) 규칙을 따릅니다.

```
<type>: <description>
```

| 타입        | 사용 시점                                        |
| ---------- | -------------------------------------------------- |
| `feat`     | 새 기능이나 API를 추가할 때                        |
| `fix`      | Socket.IO와 어긋나던 동작을 바로잡았을 때           |
| `test`     | 테스트 케이스, 픽스처, 패리티 검증을 추가할 때       |
| `docs`     | README, 예제, API 문서를 손볼 때                    |
| `refactor` | 동작은 그대로 두고 구조만 정리할 때                 |
| `chore`    | 빌드 설정, CI, 의존성, 툴링을 만질 때               |

scope는 쓰지 않습니다. smocket은 단일 패키지라서 `feat(core):`가 아니라 그냥 `feat:`이면 됩니다.

각 타입은 라벨 하나씩과 매핑되고, PR 제목을 보고 라벨이 자동으로 붙습니다. 그래서 이 표에 없는 타입을 쓰면 체크가 실패합니다. 자세한 내용은 [docs/labels.md](docs/labels.md)를 참고해 주세요.

70자 안팎의 명령형 설명이면 충분합니다. 제목에 이슈 번호까지 넣을 필요는 없고, 이슈 링크는 PR 본문에서 걸어 주시면 됩니다.

```
feat: add room join and leave
fix: keep room membership after a client disconnects
test: cover broadcast exclusion for the sender
```

## Pull Request

PR은 `main`을 대상으로 열어 주세요. 본문에 `Closes #12`처럼 이슈를 링크해 두면 머지될 때 해당 이슈도 함께 닫힙니다.

리뷰를 요청하기 전에 아래 사항들을 한 번씩 확인해 주시면 좋습니다.

- 테스트가 통과하는지 (`pnpm test --run`)
- 타입 체크가 통과하는지 (`pnpm typecheck`)
- 새로 추가한 동작에, 변경 사항이 없으면 실패하는 테스트가 딸려 있는지
- 실제 Socket.IO와 동작이 일치하는지, 그리고 그걸 어디서 확인했는지 말할 수 있는지

가장 중요한 건 마지막 항목입니다. smocket이 이미 하고 있는 동작을 그대로 확인하는 테스트는 큰 의미가 없고, Socket.IO의 실제 동작을 그대로 담아낸 테스트가 제일 가치 있습니다. [docs/conformance.md](docs/conformance.md)에 지금까지 반영된 것과 아직 안 된 것, 그리고 새 케이스가 거쳐야 하는 절차가 정리되어 있으니, 케이스를 추가하거나 이름을 바꿨다면 `pnpm conformance`를 실행해서 이 문서가 테스트 스위트와 어긋나지 않게 맞춰 주세요.

PR은 rebase 방식으로 머지되니, 리뷰를 요청하기 전에 커밋 히스토리를 한 번 정리해 주세요. 커밋 하나하나가 그대로 `main`에 올라가기 때문에, 위의 커밋 규칙을 따라 주시면 도움이 됩니다.

## 버그 신고

Bug report 템플릿을 이용해 주세요. 재현 가능한 코드 스니펫만큼 빠른 해결책은 없습니다. 전달 관련 버그는 설명만으로 파악하기가 특히 어려운데, 결국 어떤 소켓이 무엇을 받았는지, 어느 room이나 namespace에서 그랬는지가 관건이기 때문입니다.

소켓을 설정하고, emit을 실행한 다음, 어떤 소켓이 이벤트를 받을 거라 예상했는지와 실제로 어떤 소켓이 받았는지만 적어 주셔도 충분합니다.

## License

기여하신다는 건, 그 기여물이 MIT 라이선스로 배포되는 데 동의하신다는 뜻입니다.
