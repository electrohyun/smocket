> 이 문서는 [glossary.md](./glossary.md)의 한국어판입니다.
> 영어판과 함께 작성되었으며, 두 문서가 어긋나면 영어판이 정본입니다.

# Glossary

> **TL;DR** smocket 문서 전반에서 반복되는 socket.io 도메인 용어의 조회용 사전입니다.
> 각 문서는 첫 등장에서 여기로 링크하며 용어를 다시 정의하지 않습니다. 항목은 socket.io
> 자체를 설명하고, smocket 고유 동작은 각자의 주인 문서에 둡니다.

용어는 의존 순서로 나열합니다. 뒤 항목이 앞 항목에 기댑니다.

## room

소켓이 `join`·`leave`할 수 있는 서버측 라벨입니다. 브로드캐스트가 room을 대상으로 삼으면
그 시점의 멤버 전원에게 정확히 도달하며, 한 소켓이 동시에 여러 room에 속할 수 있습니다.

## namespace

자체 소켓·room·핸들러를 갖는, 이름 붙은 채널(`/`나 `/admin` 같은 경로)입니다. 격리는
완전합니다. 한 namespace의 브로드캐스트는 다른 namespace의 소켓에 절대 닿지 않습니다.

## adapter

room 멤버십을 저장하고 브로드캐스트가 어떤 소켓을 대상으로 하는지 해석하는, namespace마다
하나씩 있는 구성요소입니다. 기본 adapter는 이를 메모리에 두고, Redis adapter는 이를 교체해
여러 서버에 걸칩니다.

## ack

acknowledgement(확인 응답)의 줄임말입니다. `emit`의 마지막 인자로 넘기는 콜백으로,
수신자가 이를 호출해 값을 돌려보내며, 단일 이벤트를 요청/응답 왕복으로 바꿉니다.

## handshake

클라이언트가 연결할 때의 최초 교환으로, headers·query·auth 같은 연결 메타데이터를 담습니다.
서버는 이를 `socket.handshake`로 읽습니다.

## broadcast

하나의 이벤트를 단일 상대가 아니라 여러 소켓에 한 번에 보내는 것입니다. `io.emit`은 그
namespace의 모든 소켓에 도달하며, room이나 `except`가 그 대상 범위를 좁힙니다.

## sid

소켓의 세션 id입니다. 연결 시 배정되어 `socket.id`에 담기는 고유 식별자입니다. 각 소켓은
자신의 sid와 같은 이름의 room에도 자동으로 들어가며, 이것이 브로드캐스트가 소켓 하나를
지정할 수 있는 방식입니다.

## nsp

namespace를 가리키는 socket.io 자체의 줄임말로, 속성(`socket.nsp`)으로 쓰이고
`io.of(name)`이 반환합니다. namespace를 참고하세요.

## broadcast operator

`io.to(room)`·`socket.broadcast`·`socket.except(room)`과 그 형제들이 반환하는 객체입니다.
대상 room 집합과 제외 room 집합을 쥐고 `emit`을 노출하므로, 모든 브로드캐스트 형태가 서로
다른 집합으로 만든 하나의 메커니즘입니다.
