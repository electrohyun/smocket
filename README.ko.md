> 이 문서는 [README.md](README.md)의 한국어판입니다.
> 기준 커밋: `480ffec`. 두 문서가 어긋나면 영어 원문이 정본입니다.

<p align="center">
  <!-- The banner carries the wordmark and the one-line pitch, which is why no
       heading or tagline repeats them here. The alt text is what a reader gets
       when the image does not load, so it says the same thing in words. -->
  <img
    src="https://ik.imagekit.io/electrohyun/smocket.png?tr=w-1280"
    width="100%"
    alt="smocket. Test socket.io without a server. Sweet setup, rocket speed."
  />
</p>

<p align="center">
  <!-- One workflow badge covering both the real and mock jobs; it goes red if
       either target regresses. -->
  <a href="https://github.com/electrohyun/smocket/actions/workflows/ci.yml">
    <img src="https://github.com/electrohyun/smocket/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI (real + mock)" />
  </a>
  <a href="https://github.com/electrohyun/smocket/actions/workflows/published-consumer.yml">
    <img src="https://github.com/electrohyun/smocket/actions/workflows/published-consumer.yml/badge.svg?branch=main" alt="published package consumer" />
  </a>
  <a href="https://www.npmjs.com/package/smocket">
    <img src="https://img.shields.io/npm/v/smocket" alt="npm version" />
  </a>
  <a href="https://codecov.io/gh/electrohyun/smocket">
    <img src="https://img.shields.io/codecov/c/github/electrohyun/smocket" alt="coverage" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/npm/l/smocket" alt="license" />
  </a>
  <a href="CODE_OF_CONDUCT.md">
    <img src="https://img.shields.io/badge/code%20of%20conduct-contributor%20covenant-blue" alt="code of conduct" />
  </a>
</p>

<p align="center">
  <a href="https://smocket-site.vercel.app">smocket-site.vercel.app</a>
</p>

<p align="center">
  <a href="README.md">English</a>
</p>

> **상태: pre-1.0.** 이벤트 전달의 핵심 구현은 완료됐으며, 실제 socket.io와
> smocket에 같은 테스트를 실행하는 dual-run 방식으로 정합성을 계속 검증합니다.
> 공개 API는 1.0.0 전에 변경될 수 있습니다.
> [v1.0.0 로드맵](docs/roadmap.md)과
> [버전 번호가 약속하는 것](docs/conformance.md#what-a-version-number-promises)을 참고해 주세요.

<a id="the-problem"></a>

## 문제

테스트에서 소켓이 필요하면 우선 하나를 직접 만들게 됩니다.

```ts
const socket = {
  handlers: {} as Record<string, (...args: unknown[]) => void>,
  on(event: string, handler: (...args: unknown[]) => void) {
    this.handlers[event] = handler;
  },
  emit(event: string, ...args: unknown[]) {
    this.handlers[event]?.(...args);
  },
};
```

이 정도면 소켓을 사용하는 컴포넌트의 초기 테스트 몇 개는 작성할 수 있습니다. 하지만
같은 room에 다른 사용자가 들어오는 순간 상황이 달라집니다. 다른 사용자는 메시지를 받고,
발신자는 받지 않았는지 확인해야 합니다.

위 객체로는 이 결과를 검증할 수 없습니다. `handlers` 맵이 하나뿐이어서 `emit`은 발신자
자신의 리스너만 호출합니다. 이벤트 수신 대상은 room 멤버십과 namespace, 사용한
broadcast 방식의 조합으로 결정되므로 맵을 하나 더 추가해도 충분하지 않습니다. 직접 만든
mock에는 이 개념이 없어서, 실제 기능에 room과 broadcast가 필요한 순간 어려움을
맞닥뜨립니다.

## 해결 방법

smocket은 room 멤버십과 broadcast 규칙 자체를 재현합니다.

```ts
io.on('connection', (socket) => {
  socket.on('say', (room: string, text: string) => {
    // Everyone in the room except the sender, which is what `socket.to` means.
    socket.to(room).emit('said', text);
  });
});
```

## 빠른 시작

```bash
npm install -D smocket
```

```ts
// chat.test.ts
import { connect, Server } from 'smocket';
import { afterEach, beforeEach, expect, test } from 'vitest';

const URL = 'http://localhost:3000';
let io: Server;

beforeEach(() => {
  // The server your app talks to, wired exactly as in socket.io.
  io = new Server(URL);

  io.on('connection', (socket) => {
    socket.on('join', async (room: string, ack: () => void) => {
      await socket.join(room);
      ack();
    });
    socket.on('say', (room: string, text: string) => {
      socket.to(room).emit('said', text);
    });
  });
});

afterEach(async () => {
  await io.close();
});

test('a broadcast reaches the other member of the room', async () => {
  const alice = connect(URL);
  const bob = connect(URL);

  await new Promise<void>((done) => alice.emit('join', 'lobby', done));
  await new Promise<void>((done) => bob.emit('join', 'lobby', done));

  const heard = new Promise((resolve) => bob.on('said', resolve));
  alice.emit('say', 'lobby', 'hello');

  await expect(heard).resolves.toBe('hello');
});
```

```bash
npx vitest run
```

`afterEach`는 `close()`가 두 클라이언트의 연결을 끊고 smocket의
[origin registry](docs/glossary.md#origin-registry)에서 서버를 제거할 때까지 기다립니다.
따라서 다음 테스트에는 이전 서버와 room 상태가 남지 않습니다.

위 코드는 이 저장소에서 사용하는 Vitest로 작성했습니다. smocket은 테스트 러너에 대한
런타임 의존성이 없으며, 러너 패키지는 [개발 의존성](package.json)에만 있습니다. 이
저장소는 Vitest와 `node:test`에서 smocket을 실행하지만, 아직 독립된 clean Jest consumer는
없습니다. Jest 설정은 문서화되어 있으나 clean Jest 도입은 아직 검증되지 않았으며
[#280](https://github.com/electrohyun/smocket/issues/280)에서 추적합니다.

`connect(url)`과 `io.on('connection')`은 각각 socket.io-client와 socket.io가 실제로
사용하는 진입점입니다. 애플리케이션에서 평소 작성하던 연결 코드와 같고, import만
smocket으로 바뀝니다.

`socket.to`는 발신자를 제외하므로 Bob은 Alice가 보낸 내용을 받고 Alice는 받지 않습니다.
빠른 시작에서는 Bob의 수신만 확인합니다. Alice의 미수신은 마커 패턴으로 증명하며,
자세한 검증은
[정합성 사례](docs/conformance.md#broadcast)에 남겨 두었습니다.

### 다음 출발점

| 현재 상황                             | 시작할 곳                                                                |
| ------------------------------------- | ------------------------------------------------------------------------ |
| Vitest                                | 위의 빠른 시작 예제                                                      |
| Jest 또는 다른 CJS 러너               | [문서화된 설정과 현재 근거의 한계](docs/test-runner-integration.md#jest) |
| `socket.io-client`를 import하는 앱    | 모듈 경로를 교체하는 [테스트 러너 통합](docs/test-runner-integration.md) |
| 직접 작성한 소켓 mock                 | [문제](#the-problem)                                                     |
| 실행 가능한 프로그램을 보고 싶은 경우 | [examples/chat-room](examples/chat-room/)                                |
| 정확한 보장 범위를 확인하고 싶은 경우 | [정합성 보고서](docs/conformance.md)                                     |

기존 애플리케이션을 smocket에 맞춰 다시 작성할 필요는 없습니다. smocket은
socket.io-client와 같은 이름의 `io`를 내보냅니다. 테스트 러너에서
`socket.io-client`가 smocket을 가리키도록 설정하면 애플리케이션의 import를 바꾸지 않고도
같은 코드를 실행할 수 있습니다. Vitest 설정과 아직 검증되지 않은 Jest 설정은
[테스트 러너 통합](docs/test-runner-integration.md)에서 확인할 수 있습니다.

## 예제

실행 가능한 프로그램은 배포 패키지와 분리된 [examples/](examples/)에 있습니다.
[chat-room](examples/chat-room/)은 세 참여자가 두 room에서 대화하고, 운영자 공지를 보내고,
연결 종료를 확인하는 흐름을 보여 줍니다. 저장소를 새로 clone했다면 `pnpm install` 다음
`pnpm example:chat-room`을 실행하면 됩니다. CI에서도 push마다 같은 예제를 실행하므로
예제가 깨지면 바로 드러납니다.

[chat room package consumer](consumers/chat-room/)는 npm에서 배포 버전을 설치하거나 pull
request에서 만든 tarball을 설치한 뒤 같은 애플리케이션을 실행합니다.
[저장소 기반 StackBlitz 프로젝트](https://stackblitz.com/github/electrohyun/smocket)에서도
실행할 수 있습니다.

## 다른 방식과의 비교

**직접 작성한 mock과 비교.** [단일 워크플로 사례 연구](docs/application-case-study.md)에서
handwritten mock은 실제 Socket.IO 및 배포된 smocket과 같은 워크플로와 assertion을
통과했습니다. handwritten mock은 패키지 의존성과 포트가 필요하지 않았습니다. smocket은
패키지 의존성 하나가 필요했지만 포트는 필요하지 않았고, 실제 Socket.IO는 로컬 서버와
포트 설정을 직접 소유했습니다. 따라서 의존성과 포트 설정은 실제 Socket.IO보다 smocket이
단순했고, smocket보다 handwritten 대상이 더 단순했습니다. 별도의 소유권 차이는
애플리케이션이 handwritten mock의 동작 구현을 소유하고, smocket fixture는 더 작은
bootstrap 뒤에서 패키지가 제공하는 동작을 사용했다는 점입니다.

검증한 이벤트나 room 의미가 바뀌면 애플리케이션이 handwritten 구현을 유지보수해야 할 수
있다는 점은 합리적인 추론입니다. 사례 연구는 그런 미래 변경을 관찰하지 않았으며, 하나의
워크플로만으로 보편적인 생산성 결과나 모든 handwritten mock의 특성을 말할 수 없습니다.

**HTTP mocking과 비교.** 두 도구는 서로 다른 계층을 다룹니다. HTTP mocking은 트랜스포트
계층에서 요청에 어떤 응답을 돌려줄지 정합니다. socket.io의 전달 규칙은 그 위에서 어떤
소켓이 이벤트를 받을지 정합니다. 일반적인 테스트에는 둘 다 필요하고 역할은 겹치지 않으므로,
smocket은 트랜스포트까지 흉내 내지 않습니다.
[결정 0009](docs/decisions/0009-no-raw-websocket-mocking.md)를 참고해 주세요.

## 정합성

smocket이 지원한다고 밝힌 모든 동작은 같은 테스트 파일을 실제 socket.io 서버에서 먼저
실행하고 smocket에서 다시 실행해 측정한 결과입니다. 양쪽 모두 통과한 동작만 공개하며,
위 CI 배지는 두 실행 중 하나라도 실패하면 빨간색으로 바뀝니다.

[정합성 보고서](docs/conformance.md)는 이 실행 결과에서 생성됩니다. 검증된 각 동작을 해당
테스트와 연결하고, 아직 측정하지 않은 API 범위와 의도적으로 다른 부분도 함께 기록합니다.
smocket이 어디까지 재현하는지 가장 빠르게 확인하려면
[room](docs/conformance.md#rooms),
[broadcast chaining](docs/conformance.md#broadcast-chaining),
[connection middleware](docs/conformance.md#connection-middleware),
[acknowledgement timeout](docs/conformance.md#acknowledgement-timeouts),
[volatile emit](docs/conformance.md#volatile-emits),
[catch-all listener](docs/conformance.md#catch-all-listeners),
[socket.data](docs/conformance.md#socketdata),
[disconnect](docs/conformance.md#disconnect) 항목을 살펴보면 됩니다.

## 호환성

CI job이 아래 표의 각 답을 검증합니다. 각 job은 [`ci.yml`](.github/workflows/ci.yml)에서
볼 수 있으며, 판단 근거를 포함한 표는
[정합성 보고서](docs/conformance.md#supported-versions)에 있습니다.

| 질문                                   | 답변                                        | Job                   |
| -------------------------------------- | ------------------------------------------- | --------------------- |
| 어떤 Node에서 테스트를 실행하는가      | Linux의 22와 24, Windows와 macOS의 현재 LTS | `test`                |
| 어떤 Node에서 배포 패키지가 실행되는가 | `engines.node`가 선언한 하한인 20 이상      | `declared node floor` |
| 어떤 socket.io 버전에 사례가 유효한가  | 4.7과 4.8                                   | `real target`         |
| 어떤 브라우저에서 mock이 실행되는가    | Chromium, mock 대상만                       | `browser`             |

패키지는 ESM과 CJS 빌드에 맞는 타입 선언을 각각 제공하며, CI를 실행할 때마다 `publint`와
`arethetypeswrong`으로 패키지 구성을 검증합니다.

## 범위 밖

v1.0.0까지 어떤 기능을 보장할지는 계속 검토하고 있습니다. 아래 항목은 실제 네트워크가 없는
mock에서 그대로 재현할 수 없어 현재 지원 범위에서 제외합니다. 애플리케이션의 연결 끊김이나
재연결 처리 코드를 실행해 볼 수 있는 테스트용 시뮬레이션은 별도로 검토합니다.

- **재연결 동작 재현.** 다시 연결할 실제 연결이 없습니다. 연결이 끊긴 상태를 강제로 만들어
  애플리케이션의 재연결 핸들러를 실행하는 시뮬레이션 기능은 v1.0.0까지 별도로 검토합니다.
- **트랜스포트 폴백.** 서로 전환할 WebSocket 또는 HTTP long-polling 트랜스포트가 없습니다.
- **하트비트.** ping을 보낼 실제 연결이 없으므로 타임아웃도 발생하지 않습니다. 타임아웃 뒤에
  일어나는 disconnect 자체는 `socket.disconnect()`로 확인할 수 있습니다.
- **멀티 서버 확장.** 하나의 인메모리 프로세스에는 Redis adapter가 연결할 두 번째 서버가
  없습니다.
- **바이너리 인코딩.** 네트워크로 직렬화되는 데이터가 없으므로 인코딩할 프레임도 없습니다.

계층 구분을 포함한 전체 경계는 [scope.md](docs/scope.md)에 있습니다.

## FAQ

<details>
<summary>이미 HTTP를 mock하고 있습니다. smocket은 어디에 사용하나요?</summary>

HTTP mocking은 트랜스포트 계층에서 요청과 응답을 다룹니다. socket.io의 전달 규칙은 그보다
위에 있습니다. 트랜스포트 단계의 도구만으로 이를 구현하려면 socket.io의 wire protocol부터
room, namespace, broadcast 방식까지 직접 만들어야 합니다. 이는 HTTP mocking과 별개의
작업이며, smocket은 그 부분을 담당합니다.
[결정 0009](docs/decisions/0009-no-raw-websocket-mocking.md)를 참고해 주세요.

</details>

<details>
<summary>기존 HTTP mock을 유지하면서 smocket을 추가할 수 있나요?</summary>

네. HTTP는 기존에 사용하던 도구로 처리하고 소켓만 smocket에 맡기면 됩니다. 두 도구가
서로의 동작을 가로채지 않으므로 같은 테스트 환경에서 함께 실행할 수 있습니다.

</details>

<details>
<summary>재연결이 없는 이유는 무엇인가요?</summary>

재연결은 실제 연결이 끊긴 뒤 일정 시간을 두고 다시 연결을 시도하는 동작입니다. mock에는
끊길 실제 연결이 없으므로 재시도 간격도 근거 없이 만들어 낸 값이 됩니다. 테스트에서 필요한
것이 애플리케이션의 재연결 핸들러를 실행하는 일이라면, 연결이 끊긴 상태를 직접 발생시켜
확인할 수 있습니다. [scope.md](docs/scope.md)를 참고해 주세요.

</details>

<details>
<summary>실제 서버 없이 테스트하면 백엔드 계약과 어긋나지 않나요?</summary>

dual-run은 이 위험 가운데 socket.io가 담당하는 부분을 확인합니다. 각 테스트를 실제
socket.io 서버에서 먼저 실행하므로 테스트의 기준은 socket.io의 동작입니다. 같은 파일을
smocket에서도 실행하고, 결과가 다르면 CI가 실패합니다. 애플리케이션 서버에 직접 작성한
핸들러는 계약 테스트나 통합 테스트에서 검증합니다.

</details>

<details>
<summary>socket.io 새 버전이 출시되면 어떻게 하나요?</summary>

테스트는 여러 버전에서 실행됩니다. CI는 socket.io 4.7과 4.8의 타입을 각각 검사하고
실제 서버 테스트를 실행합니다. 두 버전에서 모두 성립하지 않는 동작이나 공유 타입이 있다면
지원한다고 문서화하기 전에 실패로 드러납니다. 버전별 차이는 실제 측정 결과에 맞춰 타입에
반영하고 문서에도 기록합니다. 새 버전을 지원할 때는 먼저 CI matrix에 해당 버전을 추가해
같은 검증을 거칩니다.

</details>

<details>
<summary>smocket이 도메인 로직도 mock하나요?</summary>

smocket은 어떤 소켓이 어떤 이벤트를 어느 room과 namespace에서 어떤 순서로 받는지
재현합니다. 이벤트를 받은 뒤 실행할 도메인 로직은 애플리케이션의 핸들러에 그대로 남습니다.
빠른 시작 예제도 일반 애플리케이션 코드에서 import만 바꾼 형태입니다.

</details>

<details>
<summary>Jest나 다른 CJS 러너에서도 동작하나요?</summary>

패키지는 ESM과 CJS 빌드에 맞는 타입 선언을 각각 제공하며, CI에서 두 형식이 올바르게
불러와지는지 확인합니다. 이는 CJS 러너의 전제 조건을 검증하지만 clean Jest 도입 전체를
검증하지는 않습니다. [테스트 러너 통합](docs/test-runner-integration.md#jest)은
`moduleNameMapper` 설정을 문서화하지만, 이 저장소에는 이를 실행하는 독립된 clean Jest
consumer가 아직 없습니다. 따라서 전체 경로는 미검증 상태이며, 부족한 실행 근거는
[#280](https://github.com/electrohyun/smocket/issues/280)에서 다룹니다.

</details>

<details>
<summary>raw WebSocket이 범위 밖인 이유는 무엇인가요?</summary>

raw WebSocket은 트랜스포트 계층에 있으며 smocket과 다른 문제를 다룹니다. raw WebSocket
mock은 네트워크를 오간 바이트를 확인하고, smocket은 emit, join, broadcast 결과로 어떤
소켓이 무엇을 받았는지 확인합니다. 트랜스포트를 가로채는 도구가 첫 번째 역할을 이미
담당하고 있으므로 smocket은 두 번째 역할에 집중합니다.
[결정 0009](docs/decisions/0009-no-raw-websocket-mocking.md)를 참고해 주세요.

</details>

## 문서

| 문서                                                          | 내용                                                              |
| ------------------------------------------------------------- | ----------------------------------------------------------------- |
| [docs/README.md](docs/README.md)                              | 궁금한 내용에 따라 찾아가는 문서 지도                             |
| [roadmap.md](docs/roadmap.md)                                 | v1.0.0까지의 보장, 의존성, 릴리스 경로                            |
| [test-runner-integration.md](docs/test-runner-integration.md) | Vitest와 Jest에서 smocket을 실행하고 타입을 유지하는 방법         |
| [conformance.md](docs/conformance.md)                         | 실제 socket.io와 비교 검증한 동작을 테스트 결과에서 생성한 보고서 |
| [scope.md](docs/scope.md)                                     | smocket이 재현하는 범위와 그 경계의 근거                          |
| [differences.md](docs/differences.md)                         | 실제 socket.io와 의도적으로 다른 점, smocket에만 있는 기능        |
| [glossary.md](docs/glossary.md)                               | 다른 문서에서 반복해서 사용하는 socket.io 용어                    |
| [decisions/](docs/decisions/README.md)                        | 선택하지 않은 대안까지 포함한 설계 결정 기록                      |
| [adapter-registration.md](docs/adapter-registration.md)       | 직접 만든 adapter로 broadcast 대상을 바꾸는 방법                  |
| [CONTRIBUTING-docs.md](docs/CONTRIBUTING-docs.md)             | 이 저장소에서 문서를 작성하는 방법                                |
| [labels.md](docs/labels.md)                                   | Issue와 Pull Request 라벨의 의미                                  |

한국어판이 있는 문서는 원문 옆에 `<name>.ko.md`로 있으며, 두 문서가 다르면 영어판이
정본입니다.

## 기여

기여를 환영합니다. 그중에서도 실제 socket.io의 동작을 테스트로 남기는 기여가 가장 직접적인
도움이 됩니다.

처음 기여할 때는 정합성 사례에서 시작할 수 있습니다. 실제 실행 결과라는 명확한 판단 기준이
있기 때문입니다. 보고서에는
[아직 테스트하지 않은 API 범위](docs/conformance.md#not-covered-yet)가 정리되어 있고,
[사례 추가 방법](docs/conformance.md#how-to-add-a-case)도 안내되어 있습니다. 실제
socket.io에서는 통과하지만 smocket에서는 실패하는 테스트를 찾았다면, 두 구현의 차이와
재현 방법을 한 번에 제시한 셈입니다.

[마일스톤](https://github.com/electrohyun/smocket/milestones)은 각 릴리스의 목표를 보여 주며,
나머지는 [이슈 트래커](https://github.com/electrohyun/smocket/issues)에 있습니다.

개발 환경 설정, 작업을 제안할 곳, commit 컨벤션, Pull Request merge 방식은
[CONTRIBUTING.md](CONTRIBUTING.md)에 정리되어 있습니다.
[한국어 가이드](CONTRIBUTING.ko.md)에서도 같은 내용을 확인할 수 있습니다. 실제 socket.io와
smocket 두 테스트 대상을 실행하는 방법은 [AGENTS.md](AGENTS.md)를 참고해 주세요.

## 기여자

[![Contributors](https://contrib.rocks/image?repo=electrohyun/smocket)](https://github.com/electrohyun/smocket/graphs/contributors)

## 라이선스

MIT. [LICENSE](LICENSE)를 참고해 주세요.
