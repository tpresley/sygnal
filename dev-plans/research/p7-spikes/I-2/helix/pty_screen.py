"""A pseudo-terminal driver with a minimal screen model, standard library only (I-2, Helix has no
scripting API). Spawns a program in a pty, sends keys, and renders what it drew into a text grid
(cursor moves, erase, text; colours are dropped), so a TUI's screen can be saved as plain text.

    t = Pty(['hx', 'src/C.jsx'], cwd=..., env=..., rows=50, cols=200)
    t.wait(3); t.send(':5\r'); t.wait(1); print(t.screen())
"""
import os, pty, re, select, signal, struct, fcntl, termios, time

CSI = re.compile(rb'\x1b\[([?>=]?)([0-9;:]*)([ -/]*)([@-~])')


class Pty:
    def __init__(self, argv, cwd=None, env=None, rows=50, cols=200):
        self.rows, self.cols = rows, cols
        self.grid = [[' '] * cols for _ in range(rows)]
        self.alt = None
        self.r = self.c = 0
        self.buf = b''
        self.raw = bytearray()
        pid, fd = pty.fork()
        if pid == 0:
            if cwd:
                os.chdir(cwd)
            os.execvpe(argv[0], argv, env or os.environ)
        self.pid, self.fd = pid, fd
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
        os.kill(pid, signal.SIGWINCH)

    # ---------------------------------------------------------------- io
    def pump(self, timeout=0.05):
        while True:
            r, _, _ = select.select([self.fd], [], [], timeout)
            if not r:
                return
            try:
                data = os.read(self.fd, 65536)
            except OSError:
                return
            if not data:
                return
            self.raw += data
            self.feed(data)
            # answer a cursor-position query (crossterm asks at start-up)
            if b'\x1b[6n' in data:
                os.write(self.fd, f'\x1b[{self.r + 1};{self.c + 1}R'.encode())
            timeout = 0.02

    def wait(self, seconds):
        end = time.time() + seconds
        while time.time() < end:
            self.pump(min(0.1, max(0.0, end - time.time())))

    def send(self, keys, delay=0.15):
        os.write(self.fd, keys.encode() if isinstance(keys, str) else keys)
        self.wait(delay)

    def close(self, timeout=5):
        end = time.time() + timeout
        while time.time() < end:
            self.pump(0.05)
            pid, status = os.waitpid(self.pid, os.WNOHANG)
            if pid:
                return os.waitstatus_to_exitcode(status)
        os.kill(self.pid, signal.SIGKILL)
        os.waitpid(self.pid, 0)
        return None

    # ---------------------------------------------------------------- screen
    def screen(self):
        return '\n'.join(''.join(row).rstrip() for row in self.grid)

    def put(self, ch):
        if self.c >= self.cols:
            self.c = 0
            self.r = min(self.rows - 1, self.r + 1)
        if 0 <= self.r < self.rows:
            self.grid[self.r][self.c] = ch
        self.c += 1

    def feed(self, data):
        self.buf += data
        b = self.buf
        i = 0
        while i < len(b):
            ch = b[i]
            if ch == 0x1b:
                m = CSI.match(b, i)
                if m:
                    self.csi(m.group(1), m.group(2), m.group(4))
                    i = m.end()
                    continue
                if i + 1 >= len(b):
                    break  # incomplete escape: wait for more
                nxt = b[i + 1:i + 2]
                if nxt == b'[':
                    break  # incomplete CSI
                if nxt == b']':  # OSC: up to BEL or ST
                    end = b.find(b'\x07', i)
                    st = b.find(b'\x1b\\', i)
                    ends = [e for e in (end, st) if e >= 0]
                    if not ends:
                        break
                    e = min(ends)
                    i = e + (1 if e == end else 2)
                    continue
                i += 2 if nxt not in (b'(', b')') else 3
                continue
            if ch == 0x0d:
                self.c = 0; i += 1; continue
            if ch == 0x0a:
                self.r = min(self.rows - 1, self.r + 1); i += 1; continue
            if ch == 0x08:
                self.c = max(0, self.c - 1); i += 1; continue
            if ch < 0x20:
                i += 1; continue
            # UTF-8 sequence
            n = 1 if ch < 0x80 else 2 if ch >> 5 == 0b110 else 3 if ch >> 4 == 0b1110 else 4
            if i + n > len(b):
                break
            self.put(b[i:i + n].decode('utf-8', 'replace'))
            i += n
        self.buf = b[i:]

    def csi(self, private, params, final):
        p = [int(x) if x else 0 for x in params.decode().replace(':', ';').split(';')] if params else []
        a = lambda k, d: p[k] if len(p) > k and p[k] else d
        f = final.decode()
        if private == b'?':
            if params in (b'1049', b'47', b'1047') and f in 'hl':
                self.grid = [[' '] * self.cols for _ in range(self.rows)]
            return
        if f in 'Hf':
            self.r, self.c = min(self.rows - 1, a(0, 1) - 1), min(self.cols - 1, a(1, 1) - 1)
        elif f == 'A': self.r = max(0, self.r - a(0, 1))
        elif f == 'B': self.r = min(self.rows - 1, self.r + a(0, 1))
        elif f == 'C': self.c = min(self.cols - 1, self.c + a(0, 1))
        elif f == 'D': self.c = max(0, self.c - a(0, 1))
        elif f == 'G': self.c = min(self.cols - 1, a(0, 1) - 1)
        elif f == 'd': self.r = min(self.rows - 1, a(0, 1) - 1)
        elif f == 'J':
            mode = a(0, 0)
            if mode == 2 or mode == 3:
                self.grid = [[' '] * self.cols for _ in range(self.rows)]
            elif mode == 0:
                self.grid[self.r][self.c:] = [' '] * (self.cols - self.c)
                for r in range(self.r + 1, self.rows): self.grid[r] = [' '] * self.cols
            elif mode == 1:
                for r in range(0, self.r): self.grid[r] = [' '] * self.cols
                self.grid[self.r][:self.c + 1] = [' '] * (self.c + 1)
        elif f == 'K':
            mode = a(0, 0)
            if mode == 0: self.grid[self.r][self.c:] = [' '] * (self.cols - self.c)
            elif mode == 1: self.grid[self.r][:self.c + 1] = [' '] * (self.c + 1)
            else: self.grid[self.r] = [' '] * self.cols
        elif f == 'X':
            n = a(0, 1)
            for k in range(self.c, min(self.cols, self.c + n)): self.grid[self.r][k] = ' '
        # m (colours), r (scroll region), s/u and the rest: ignored
