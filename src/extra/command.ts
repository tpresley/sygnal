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
  /** @internal — stamped by component.ts when wired to a child */
  _targetComponentId?: number;
  /** @internal — stamped by component.ts when wired to a child */
  _targetComponentName?: string;
}

export function createCommand(): Command {
  const listener: { next: (val: CommandMessage) => void } = { next: () => {} };

  const _stream: Stream<CommandMessage> = xs.create({
    start(l: any) { listener.next = (val) => l.next(val); },
    stop() { listener.next = () => {}; },
  });

  const cmd: Command = {
    send: (type: string, data?: any) => {
      listener.next({ type, data });
      if (typeof window !== 'undefined' && (window as any).__SYGNAL_DEVTOOLS__?.connected) {
        (window as any).__SYGNAL_DEVTOOLS__.onCommandSent(type, data, cmd._targetComponentId, cmd._targetComponentName);
      }
    },
    _stream,
    __sygnalCommand: true as const,
  };

  return cmd;
}

export function makeCommandSource(cmd: Command): CommandSource {
  return {
    select(type: string): Stream<any> {
      return cmd._stream.filter(msg => msg.type === type).map(msg => msg.data);
    },
  };
}
