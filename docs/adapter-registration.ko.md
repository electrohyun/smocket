> 이 문서는 [adapter-registration.md](./adapter-registration.md)의 한국어판입니다.
> 영어판과 함께 작성되었으며, 두 문서가 어긋나면 영어판이 정본입니다.

# 어댑터 등록 (Adapter registration)

> **TL;DR** `io.adapter(...)`는 테스트가 자기만의
> [adapter](./glossary.ko.md#adapter)를 넣을 수 있게 합니다. adapter는 어떤 소켓이
> [broadcast](./glossary.ko.md#broadcast)를 받을지 정하는 부품입니다. 이 API는
> 라우팅 계층이 내장 구현 하나에 묶이지 않게 하려고 존재하며, 그 가치는 등록
> 호출 자체가 아니라 그 위에 얹히는 adapter들에 있습니다.

## 어디서 시작됐나

smocket은 손으로 짠 목이 클라이언트 하나는 짝지어도 두 번째는 못 받은 데서
출발했습니다. 그 목에는 [room](./glossary.ko.md#room)·broadcast·[namespace](./glossary.ko.md#namespace)
배달이 없었습니다. smocket은 그 빠진 조각, 즉 실물 socket.io처럼 이벤트를
라우팅하는 목입니다. 이 라우팅 코어가 프로젝트의 본체입니다.

라우팅이 생기면 다음 물음은 "테스트가 그것을 바꿀 수 있나"입니다. 정확히 그것을
원하는 쓰임이 둘 있습니다.

- 매 broadcast의 대상을 기록하는 adapter입니다. 테스트가 "누가 받았나"를 단언할
  수 있습니다.
- 대상 집합에서 소켓 하나를 빼는 adapter입니다. 못 받은 메시지가 있어도 앱이
  버티는지 테스트가 확인할 수 있습니다.

둘 다 존재하려면 먼저 한 가지가 필요합니다. 바로 커스텀 adapter를 등록하는
길입니다. 그 공통 전제가 이 기능이며, 그래서 이것이 또 하나의 단독 기능이 아니라
먼저 옵니다.

## 무엇을 갈아끼울 수 있고 없나

실물 socket.io에서 adapter는 두 일을 합니다. room 멤버십을 쥐고, 이벤트를
배달합니다. smocket은 이 둘을 쪼갭니다. 여기 adapter는 broadcast가 어떤
[sid](./glossary.ko.md#sid)를 대상으로 하는지에만 답하고, 배달은 코어에 남습니다.
그래서 어떤 adapter를 등록해도 소켓별 순서가 유지됩니다([0010](./decisions/0010-single-defer-primitive-and-fifo.md) 참고).

따라서 커스텀 adapter는 broadcast의 대상을 다시 정할(관측하거나 좁힐) 수는 있어도
한 소켓의 스트림을 뒤집거나 지연시킬 수는 없습니다. 순서 뒤집기는 순서 보장이
금지하는 유일한 것이고, 스케줄링은 이 seam의 몫이 아닙니다. 소켓별 지연은 별도
기능으로 따로 추적합니다.

## 왜 지금, 왜 smocket 전용인가

이 seam은 일부러 v1.0.0 전에 들어갑니다. 그 릴리스가 공개 표면을 얼리는데, 언
뒤에 확장점을 더하는 것은 파괴적 변경입니다. 그래서 먼저 넣는 것이 라우팅 계층을
단일 인메모리 구현에 묶이지 않게 합니다([0008](./decisions/0008-adapter-api-before-v1.md)).

여기서 짠 커스텀 adapter는 실물 socket.io에서 돌지 않습니다. 실물 adapter는
배달까지 하며 smocket에는 없는 트랜스포트를 필요로 하기 때문입니다([0009](./decisions/0009-no-raw-websocket-mocking.md)).
smocket은 자신의 배달이 실물 socket.io와 일치함을 보장할 뿐, 사용자의 확장 코드가
이식 가능하다고 약속하지 않습니다. 그 경계는 [differences.md](./differences.md) §B에 적혀 있습니다.
