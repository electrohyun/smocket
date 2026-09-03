<p align="center">
  <img
    src="https://ik.imagekit.io/electrohyun/smocket.png"
    width="1280"
    alt="smocket. Mock Socket.IO without a server. Sweet as a s’more, fast as a rocket."
  />
</p>

<p align="center">
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
  ·
  <a href="https://smocket-site.vercel.app/docs">Documentation</a>
</p>

<p align="center">
  <a href="README.md">English</a>
</p>

## 왜 smocket인가요?

Socket.IO 프론트엔드를 개발할 때는 여러 클라이언트가 연결되고, room에 참여하고,
대상에 따라 서로 다른 이벤트를 받는 흐름을 확인해야 합니다. 백엔드 이벤트 API가
준비되기 전에는 이 흐름을 프론트엔드에서 실행할 곳이 없어, 다중 사용자 UI의 구현과
확인도 백엔드를 기다리게 됩니다.

직접 만든 socket 객체는 listener를 호출할 수 있지만 보통 하나의 handler map만
가집니다. room 참여 상태, namespace, broadcast 대상, acknowledgement의 생명주기를
바탕으로 수신자를 정하지 못합니다. HTTP mock은 요청과 응답을 정의할 수 있지만,
지속되는 연결 상태와 Socket.IO 라우팅을 소유하지 않습니다.

별도 로컬 Socket.IO 서버는 정확하지만 프로세스와 설정, 접속 가능한 host가 필요합니다.
프론트엔드에 애플리케이션 이벤트 계층만 필요한 상황에서는 격리된 컴포넌트 개발이나
정적 프리뷰에 적용하기 번거롭습니다.

## Socket.IO 애플리케이션 이벤트를 메모리에서 실행하기

smocket은 네트워크 서버를 열지 않고 서로 구분되는 client socket과 server socket을
만듭니다. 지원 범위 안의 Socket.IO connection handler, room과 namespace 참여 상태,
대상 지정과 broadcast 전달, acknowledgement, socket 생명주기를 프론트엔드와 같은
JavaScript 환경에서 실행합니다.

```ts
io.on('connection', (socket) => {
  socket.on('say', (room: string, text: string) => {
    socket.to(room).emit('said', text);
  });
});
```

지원 범위 안의 event handler와 도메인 로직은 실제 Socket.IO 서버와 공유할 수 있습니다.
동일 출처의 여러 브라우저 탭은 명시적인 [SharedWorker 경로](docs/shared-worker.md)를
통해 브라우저 안의 한 서버와 하나의 메모리 상태를 함께 사용할 수 있습니다. smocket은
실제 네트워크 전송을 재현하거나 프로덕션 백엔드를 대체하지 않습니다.

## 빠른 시작

```bash
npm install -D smocket smocket-client
```

두 패키지를 같은 버전으로 설치하세요. `smocket`은 프로세스 안의 서버를 소유하고,
`smocket-client`는 애플리케이션이 연결할 client API를 제공합니다. 테스트 러너는
필수가 아닙니다.

```ts
// quick-start.ts
import { Server } from 'smocket';
import { connect } from 'smocket-client';

async function main() {
  const URL = 'http://localhost:3000';
  const io = new Server(URL);

  io.on('connection', (socket) => {
    socket.on('join', async (room: string, done: () => void) => {
      await socket.join(room);
      done();
    });

    socket.on('say', (room: string, text: string) => {
      socket.to(room).emit('said', text);
    });
  });

  const alice = connect(URL);
  const bob = connect(URL);

  const joinLobby = (client: ReturnType<typeof connect>) =>
    new Promise<void>((done) => client.emit('join', 'lobby', done));

  try {
    await Promise.all([joinLobby(alice), joinLobby(bob)]);

    const bobHeard = new Promise<string>((done) => bob.once('said', done));
    alice.emit('say', 'lobby', 'hello');

    console.log(`Bob heard: ${await bobHeard}`);
  } finally {
    await io.close();
  }
}

void main();
```

파일을 프로젝트에서 쓰는 TypeScript runner로 실행하거나, 별도 파일이라면
`npx tsx quick-start.ts`를 사용하세요. `Bob heard: hello`를 출력한 뒤 `close()`가
두 client의 연결을 끊고 서버 등록을 해제합니다. 저장소에서 실행되는 room과
acknowledgement 예제는 [`examples/chat-room`](examples/chat-room/)에 있으며
`pnpm example:chat-room`으로 실행할 수 있습니다.

기존 애플리케이션은 `socket.io-client` import를 유지하고 mock을 사용하는 환경에서
패키지 이름을 `smocket-client`로 매핑할 수 있습니다.

```ts
// application code
import { io } from 'socket.io-client';
```

Vitest와 Jest 매핑은 [테스트 러너 통합](docs/test-runner-integration.md), 애플리케이션이
직접 import를 관리할 때의 선택지는 [패키지 진입점](docs/package-entry-points.md)을
확인하세요.

## React drawing game으로 확인하기

[drawing game](examples/drawing-game/)은 세 브라우저 페이지에서 실행되는 React 기반
다중 사용자 애플리케이션입니다. 자동화된 흐름에서 그림, 채팅, 정답 acknowledgement,
라운드 종료, 페이지 닫기와 새로고침, 연결 정리를 확인합니다.

smocket 경로는 SharedWorker에서 세션을 실행하고, 실제 경로는 Node Socket.IO 서버를
시작합니다. 두 경로는 같은 애플리케이션 event handler, event type, 도메인 상태,
React UI, 사용자 동작을 공유하며 연결 bootstrap만 달라집니다.

- [설치 없이 바로 실행되는 브라우저 데모 열기](https://smocket-site.vercel.app/demo)
- `pnpm example:drawing-game`으로 소스 실행하기
- [애플리케이션 case study](https://smocket-site.vercel.app/case-study)에서 Node.js
  Socket.IO와 메모리에서 실행되는 Smocket의 역할 읽기

## 지원 범위를 계속 확인하는 방법

README에 금방 바뀌는 테스트 개수를 적는 대신, 각 공개 주장을 계속 관리되는 실행
경로에 연결합니다.

| 확인할 내용                                      | 유지되는 경로                                              |
| ------------------------------------------------ | ---------------------------------------------------------- |
| 전달과 라우팅이 Socket.IO와 같은가?              | [dual-run 적합성 테스트](docs/conformance.md)              |
| 여러 브라우저 탭이 한 mock 서버를 공유하는가?    | [Chromium·SharedWorker workflow](.github/workflows/ci.yml) |
| 실제 프론트엔드에서 이벤트 계층이 동작하는가?    | [React drawing game](examples/drawing-game/)               |
| 공개 패키지를 애플리케이션에서 소비할 수 있는가? | [clean consumer 검사](consumers/test-adoption/)            |

적합성 보고서는 아직 비교하지 않은 범위와 의도적인 차이도 함께 밝힙니다. 패키지 검사는
workspace 밖에 배포 산출물을 설치하여 지원하는 module, type, test runner, browser,
SharedWorker 진입점을 확인합니다.

## 실제 Socket.IO 서버로 전환하기

애플리케이션이 `socket.io-client` import를 유지했다면 mock 전용 매핑을 제거하고 실제
서버를 가리키면 됩니다. 네트워크 서버를 시작하고 공유한 애플리케이션 handler를 그
서버의 bootstrap으로 옮깁니다. 지원 범위 안의 event 이름, handler 형태, 프레임워크에
종속되지 않는 도메인 로직은 유지할 수 있습니다.

바뀌어야 하는 부분은 smocket이 의도적으로 제공하지 않는 영역입니다. 실제 인프라의
transport 설정과 인증, 영속성, 기기 간 접근, reconnection, scaling에는 별도의 통합·
end-to-end 테스트가 필요합니다.

## 범위 밖

다음 항목은 미완성 transport 기능이 아닙니다. mock에는 실제 네트워크 연결이 없으므로
동작할 대상이 없는 transport 행동을 만들어 낼 수 없습니다.

- **Reconnection 동작 재현.** 다시 연결할 끊어진 네트워크 연결이 없습니다. 연결이 끊긴
  상태에 대한 애플리케이션 반응은 직접 실행할 수 있습니다.
- **Transport fallback.** 전환할 WebSocket 또는 HTTP long-polling transport가 없습니다.
- **Heartbeat.** ping을 보내거나 timeout이 발생할 실제 연결이 없습니다. 그 결과인
  disconnect 상태는 `socket.disconnect()`를 통해 확인할 수 있습니다.
- **다중 서버 scaling.** 하나의 메모리 프로세스에는 Redis adapter가 연결할 두 번째
  서버가 없습니다.
- **Binary encoding.** wire에 직렬화되는 값이 없으므로 encoding할 frame도 없습니다.
  binary 값을 포함한 직접 payload는 문서화된
  [메모리 passthrough 경로](docs/scope.md#not-reproduced-reliability--network-layer)에
  기존 값으로 전달되며, 이는 binary protocol 지원이 아닙니다.

문서화된 API 밖을 사용하기 전에 전체 [범위 경계](docs/scope.md)와
[의도적인 차이](docs/differences.md)를 확인하세요.

## FAQ

<details>
<summary>smocket은 실제 Socket.IO 서버를 대체하나요?</summary>

아닙니다. 프론트엔드 개발과 테스트를 위해 애플리케이션 이벤트 계층을 메모리에서
실행합니다. transport, 보안, 영속성, 기기 간 사용, 프로덕션 운영에는 실제 백엔드가
필요합니다.

</details>

<details>
<summary>Vitest, Jest 또는 다른 테스트 러너가 필요한가요?</summary>

필요하지 않습니다. 빠른 시작은 plain TypeScript이고 drawing game은 브라우저
애플리케이션으로 실행됩니다. 테스트 러너는 이미 사용하는 프로젝트를 위한 선택적
통합 경로입니다.

</details>

<details>
<summary>여러 브라우저 탭이 같은 상태를 공유할 수 있나요?</summary>

`smocket/shared-worker`와 `smocket-client/shared-worker`를 사용하면 가능합니다.
페이지는 같은 origin, browser profile, worker URL, worker 이름을 공유해야 합니다.
[SharedWorker 가이드](docs/shared-worker.md)에서 생명주기와 storage 경계를 설명합니다.

</details>

<details>
<summary>실제 Socket.IO로 전환할 때 애플리케이션을 다시 작성해야 하나요?</summary>

지원 범위 안의 애플리케이션 event handler, event 이름, 도메인 로직은 공유할 수
있습니다. 연결 bootstrap과 실제 인프라는 바뀌며, smocket의 문서화된 범위 밖에 있는
코드는 별도의 통합 검사가 필요합니다.

</details>

<details>
<summary>실제 Socket.IO와 어디까지 비교했나요?</summary>

[생성된 적합성 보고서](docs/conformance.md)가 정확한 경계입니다. 나열된 각 case는 같은
테스트 파일에서 실제 Socket.IO와 smocket을 대상으로 실행됩니다. 아직 측정하지 않은
API와 의도적인 차이도 보고서에 포함됩니다.

</details>

## 문서

| 문서 또는 경로                                      | 확인할 내용                                             |
| --------------------------------------------------- | ------------------------------------------------------- |
| [공개 문서](https://smocket-site.vercel.app/docs)   | 배포된 문서의 시작점                                    |
| [문서 지도](docs/README.md)                         | 도입, 보장 범위, 유지보수 목적에 맞는 문서              |
| [패키지 진입점](docs/package-entry-points.md)       | server, client, SharedWorker import 선택                |
| [drawing game workflow](examples/drawing-game/)     | smocket과 실제 Socket.IO를 사용한 React 개발            |
| [SharedWorker](docs/shared-worker.md)               | 동일 출처 탭에서 브라우저 안의 한 서버 공유             |
| [테스트 러너 통합](docs/test-runner-integration.md) | Vitest와 Jest에서 `socket.io-client` 매핑               |
| [적합성](docs/conformance.md)                       | 실제 Socket.IO와 비교한 동작 및 아직 측정하지 않은 범위 |
| [범위와 차이](docs/scope.md)                        | 지원 계층 및 [의도적인 차이](docs/differences.md)       |
| [문제 해결](docs/troubleshooting.md)                | 관찰한 신호에 따른 도입 실패 해결                       |
| [로드맵](docs/roadmap.md)                           | 유지되는 gate와 v1.0.0까지의 경로                       |

계속 관리되는 한국어 시작 문서는 [README.ko.md](README.ko.md)와
[CONTRIBUTING.ko.md](CONTRIBUTING.ko.md)입니다. 영문 문서가 정본이며, 두 한국어
가이드는 모든 페이지를 복제하지 않고 필요한 영문 문서로 연결합니다.

## 기여

기여를 환영합니다. 가장 유용한 기여는 Socket.IO의 실제 동작을 테스트로 남기는 것입니다.

기계적으로 비교할 수 있는 적합성 case가 가장 짧은 시작점입니다. 작업 전에
[현재 비교 범위](docs/conformance.md)와
[case 추가 방법](docs/conformance.md#how-to-add-a-case)을 확인하세요.

[마일스톤](https://github.com/electrohyun/smocket/milestones)은 각 릴리스의 목표를,
[이슈 트래커](https://github.com/electrohyun/smocket/issues)는 나머지 작업을 보여 줍니다.

개발 환경, 작업 제안과 보고, commit 규칙, Pull Request merge 방식은
[CONTRIBUTING.md](CONTRIBUTING.md)를 확인하세요. [한국어 가이드](CONTRIBUTING.ko.md)도
같은 흐름을 설명합니다. 두 테스트 대상을 실행하는 방법은 [AGENTS.md](AGENTS.md)에
있습니다.

<a id="coc-ov-file"></a>

## 행동 강령

smocket 참여에는 [Contributor Covenant 행동 강령](CODE_OF_CONDUCT.md)이 적용됩니다.

## 기여자

[![Contributors](https://contrib.rocks/image?repo=electrohyun/smocket)](https://github.com/electrohyun/smocket/graphs/contributors)

## 라이선스

MIT. [LICENSE](LICENSE)를 확인하세요. 외부 font와 프로젝트 asset의 출처는
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 기록되어 있습니다.
