import xs from './xstreamCompat';
import type {Stream} from 'xstream';

export interface CommandMessage {
  type: string;
  data?: any;
}

export interface CommandSource {
  select(type: string): Stream<any>;
}

export interface Command {
  send(type: string, data?: any): void;
  /** @internal — raw stream used by component wiring */
  _stream: Stream<CommandMessage>;
  /** @internal — marker for component.ts detection */
  __sygnalCommand: true;
}

export function createCommand(): Command {
  const listener: { next: (val: CommandMessage) => void } = { next: () => {} };

  const _stream: Stream<CommandMessage> = xs.create({
    start(l: any) { listener.next = (val) => l.next(val); },
    stop() { listener.next = () => {}; },
  });

  return {
    send: (type: string, data?: any) => listener.next({ type, data }),
    _stream,
    __sygnalCommand: true as const,
  };
}

export function makeCommandSource(cmd: Command): CommandSource {
  return {
    select(type: string): Stream<any> {
      return cmd._stream.filter(msg => msg.type === type).map(msg => msg.data);
    },
  };
}
