// Type shim for @xmpp/client which ships without TS declarations
declare module '@xmpp/client' {
  interface XmppClientOptions {
    service: string;
    domain: string;
    resource?: string;
    username: string;
    password: string;
  }

  interface XmlElement {
    toString(): string;
    attrs: Record<string, string>;
    children: XmlElement[];
    name: string;
    text(): string;
  }

  interface Address {
    toString(): string;
    local: string;
    domain: string;
    resource: string;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type EventHandler = (...args: any[]) => void;

  interface XmppClient {
    on(event: 'online',  handler: (address: Address) => void): void;
    on(event: 'offline', handler: () => void): void;
    on(event: 'error',   handler: (err: Error) => void): void;
    on(event: 'status',  handler: (status: string) => void): void;
    on(event: string,    handler: EventHandler): void;
    start(): Promise<void>;
    stop(): Promise<void>;
    send(stanza: XmlElement): Promise<void>;
  }

  export function client(options: XmppClientOptions): XmppClient;
  export function xml(name: string, attrs?: Record<string, string>, ...children: (XmlElement | string)[]): XmlElement;
}
