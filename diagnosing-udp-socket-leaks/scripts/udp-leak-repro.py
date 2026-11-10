"""Open/send/close connected UDP sockets N times and report the pcbcount delta."""
import socket, subprocess, sys, time
def pcb(): return int(subprocess.check_output(["sysctl","-n","net.inet.udp.pcbcount"]))
fam, host, port, n, recv = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5] == "recv"
af = socket.AF_INET6 if fam == "6" else socket.AF_INET
time.sleep(1); before = pcb()
for _ in range(n):
    s = socket.socket(af, socket.SOCK_DGRAM); s.connect((host, port))
    try:
        s.send(b"x:1|c")
        if recv:  # second send surfaces the ICMP port-unreachable as ECONNREFUSED
            time.sleep(0.002); s.send(b"x:1|c")
    except OSError: pass
    s.close()
time.sleep(2); after = pcb()
print(f"{fam} {host}:{port} n={n} recv={recv} before={before} after={after} delta={after-before}")
