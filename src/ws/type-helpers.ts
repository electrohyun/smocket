export type SocketUrl<Address extends string | URL | null> = Address extends null
  ? undefined
  : string;

// ws defaults an omitted setting to true, but explicit undefined disables tracking.
export type TracksClients<Options> = 'clientTracking' extends keyof Options
  ? Options extends { clientTracking: infer Tracking }
    ? Tracking extends true
      ? true
      : false
    : boolean
  : true;
