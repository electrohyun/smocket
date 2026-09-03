# smocket 기여 가이드

시간을 내어 기여해 주셔서 감사합니다.

> [!NOTE]
> smocket은 2026년 8월 v1.0.0에 도달했습니다. 공개 API와 문서화된 동작에는 이제
> [결정 0019](docs/decisions/0019-what-counts-as-a-breaking-change.md)의 호환성 규칙이
> 적용됩니다. 작은 문서 수정이나 명확한 버그 수정은 바로 PR로 제안해도 괜찮습니다.
> 새로운 기능이나 범위가 큰 변경은 중복 작업을 막기 위해 먼저 관련
> [Issue](https://github.com/electrohyun/smocket/issues/new/choose)나
> [Discussion](https://github.com/electrohyun/smocket/discussions)에서 방향을 맞춰 주세요.
>
> [로드맵](docs/roadmap.md)은 안정 버전의 범위와 반복되는 릴리스 gate를 기록합니다.
> 현재 작업은 [이슈 트래커](https://github.com/electrohyun/smocket/issues)와
> [마일스톤](https://github.com/electrohyun/smocket/milestones)에서 확인할 수 있습니다.

smocket은 [Socket.IO](https://socket.io/)의
[전달(delivery)·라우팅 계층](docs/scope.md)을 최대한 그대로 재현하는 것을 목표로
합니다. 변경을 제안하실 때는 해당 상황에서 실제 Socket.IO가 어떻게 동작하는지도 함께
알려주시면 큰 도움이 됩니다. smocket과 Socket.IO의 동작이 다르다면, 항상 Socket.IO 쪽을
기준으로 삼습니다.

## 시작하기

smocket은 [pnpm](https://pnpm.io)을 사용합니다. 먼저 GitHub에서
[smocket을 fork](https://github.com/electrohyun/smocket/fork)한 다음, 자신의 fork를 clone해 주세요.

```bash
git clone https://github.com/YOUR_USERNAME/smocket.git
cd smocket
git remote add upstream https://github.com/electrohyun/smocket.git
pnpm install
pnpm test
```

작업한 브랜치는 자신의 fork에 push하고, 원본 smocket 저장소의 `main` 브랜치를 대상으로 PR을 열어 주세요.

`pnpm test`는 [Vitest](https://vitest.dev/)를 watch 모드로 돌리는 명령이라, 작업하는 동안 켜 두면 편합니다. 따로 확인할 개발 서버가 없다 보니, 테스트 출력 자체가 곧 피드백 루프인 셈입니다.

| 명령어              | 설명                             |
| ------------------- | -------------------------------- |
| `pnpm test`         | 테스트를 watch 모드로 실행       |
| `pnpm vitest run`   | 두 테스트 프로젝트를 한 번 실행  |
| `pnpm typecheck`    | 결과물을 만들지 않고 타입만 검사 |
| `pnpm lint`         | 코드와 문서 스타일 검사          |
| `pnpm format`       | 저장소 포맷 적용                 |
| `pnpm format:check` | 파일을 바꾸지 않고 포맷 검사     |
| `pnpm docs:check`   | 문서 사이트 빌드 및 검사         |

Vitest는 어디까지나 개발 의존성일 뿐입니다. `src/` 어디에서도 import되지 않고, smocket을 설치한다고 해서 딸려 들어오지도 않습니다. spy나 fake timer가 필요한 헬퍼를 추가하게 되면, `vitest`에서 가져다 쓰는 대신 직접 구현해야 이 경계가 유지됩니다.

## 다루는 범위

[범위 문서](docs/scope.md)는 smocket이 Socket.IO의 어느 부분을 재현하는지와 네트워크
신뢰성 동작이 프로젝트 범위 밖에 머무는 이유를 설명합니다. 이 경계 안에서는 Socket.IO
동작과 어긋나지 않는 기능과 확장 지점이 계속 추가될 수 있습니다.

새로운 제안이 이 범위에 맞는지 애매하다면 코드부터 작성하지 마시고, 먼저
[Issue](https://github.com/electrohyun/smocket/issues/new/choose)나
[Discussion](https://github.com/electrohyun/smocket/discussions)에서 함께 방향을 정해 주세요.

## 어디에 남기면 좋을까

| 상황                                                                 | 이용할 곳                                                                                             |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| smocket이 실제 Socket.IO와 다르게 동작함                             | [Bug report](https://github.com/electrohyun/smocket/issues/new?template=bug_report.yml)               |
| 필요한 Socket.IO 동작을 smocket이 지원하지 않음                      | [Feature request](https://github.com/electrohyun/smocket/issues/new?template=feature_request.yml)     |
| 구체적인 편의 기능이나 adapter 변경을 제안하고 싶음                  | [Feature request](https://github.com/electrohyun/smocket/issues/new?template=feature_request.yml)     |
| API 방향, 사용 흐름, 반복되는 설정이나 유지보수 불편을 논의하고 싶음 | [Discussion](https://github.com/electrohyun/smocket/discussions)                                      |
| 문서가 잘못됐거나 부족하거나 찾기 어려움                             | [Documentation issue](https://github.com/electrohyun/smocket/issues/new?template=documentation.yml)   |
| 툴링, CI, 테스트, 리팩토링 작업을 제안하고 싶음                      | [Maintenance issue](https://github.com/electrohyun/smocket/issues/new/choose)                         |
| 구체적인 변경안 없이 실제 사용 사례나 재현 코드를 공유하고 싶음      | [Discussion](https://github.com/electrohyun/smocket/discussions). 잘못된 동작을 보여준다면 Bug report |

유용한 제보는 짧아도 괜찮습니다. 어떤 상황이었는지, 무엇을 기대했는지, 실제로는 어떻게
동작했는지만 알려주세요. 연구 계획이나 완성된 구현을 준비할 필요는 없습니다.

## 어디서부터 시작하면 좋을까

[`good first issue`](https://github.com/electrohyun/smocket/issues?q=state%3Aopen%20label%3A%22good%20first%20issue%22)
라벨이 붙은 이슈는 코드베이스 전체를 몰라도 끝낼 수 있을 만큼 범위를 좁혀 둔 것들입니다.
[`help wanted`](https://github.com/electrohyun/smocket/issues?q=state%3Aopen%20label%3A%22help%20wanted%22)는
중요하긴 하지만 아직 아무도 작업하고 있지 않은 이슈에 붙습니다.

테스트, 툴링, CI, 리팩토링 작업도 모두 환영합니다. 이럴 땐
[Maintenance 이슈 템플릿](https://github.com/electrohyun/smocket/issues/new/choose)을 사용해 주세요.

## commit

smocket은 [Conventional Commits](https://www.conventionalcommits.org) 규칙을 따릅니다.

```
<type>: <description>
```

| 타입       | 사용 시점                                                             |
| ---------- | --------------------------------------------------------------------- |
| `feat`     | 새 기능이나 API를 추가할 때                                           |
| `fix`      | Socket.IO와 어긋나던 동작을 바로잡았을 때                             |
| `test`     | 테스트 케이스, 픽스처, [정합성 검증](docs/conformance.md)을 추가할 때 |
| `docs`     | README, 예제, API 문서를 손볼 때                                      |
| `refactor` | 동작은 그대로 두고 구조만 정리할 때                                   |
| `chore`    | 빌드 설정, CI, 의존성, 툴링을 만질 때                                 |

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

- 두 테스트 프로젝트가 통과하는지 (`pnpm vitest run`)
- 타입 체크가 통과하는지 (`pnpm typecheck`)
- 린트가 통과하는지 (`pnpm lint`)
- 포맷이 최신 상태인지 (`pnpm format:check`)
- 문서 변경이 빌드되고 통합 검사를 통과하는지 (`pnpm docs:check`)
- 새로 추가한 동작에, 변경 사항이 없으면 실패하는 테스트가 딸려 있는지
- 실제 Socket.IO와 동작이 일치하는지, 그리고 그걸 어디서 확인했는지 말할 수 있는지

`pnpm format:check`가 실패하면 `pnpm format`을 실행하고 변경 내용을 검토한 뒤,
push하기 전에 검사를 다시 실행해 주세요.

가장 중요한 건 마지막 항목입니다. smocket이 이미 하고 있는 동작을 그대로 확인하는 테스트는 큰 의미가 없고, Socket.IO의 실제 동작을 그대로 담아낸 테스트가 제일 가치 있습니다. [docs/conformance.md](docs/conformance.md)에 지금까지 반영된 것과 아직 안 된 것, 그리고 새 케이스가 거쳐야 하는 절차가 정리되어 있으니, 케이스를 추가하거나 이름을 바꿨다면 `pnpm conformance`를 실행해서 이 문서가 테스트 스위트와 어긋나지 않게 맞춰 주세요.

PR은 squash 방식으로 머지됩니다. PR 제목이 `main`의 단일 커밋 제목이 되므로 conventional
형식으로 작성해 주세요. 브랜치 커밋은 리뷰할 수 있게 이해 가능한 상태를 유지하되, 최종
단일 커밋 모양을 만들기 위한 이유만으로 다시 작성할 필요는 없습니다.

## 버그 신고

[Bug report 템플릿](https://github.com/electrohyun/smocket/issues/new?template=bug_report.yml)을 이용해 주세요.
재현 가능한 코드 스니펫만큼 빠른 해결책은 없습니다. 전달 관련 버그는 설명만으로 파악하기가
특히 어렵습니다. 결국 어떤 소켓이 무엇을 받았는지, 어느
[room](docs/glossary.md#room)이나 [namespace](docs/glossary.md#namespace)에서
그랬는지가 관건이기 때문입니다.

소켓을 설정하고, emit을 실행한 다음, 어떤 소켓이 이벤트를 받을 거라 예상했는지와 실제로 어떤 소켓이 받았는지만 적어 주셔도 충분합니다.

## License

기여하신다는 건, 그 기여물이 [MIT 라이선스](LICENSE)로 배포되는 데 동의하신다는 뜻입니다.
