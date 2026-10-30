"""Свой удостоверяющий центр для HTTPS в домашней сети.

iPhone пускает веб-приложение к кодировщику видео и установке «на экран Домой» только по HTTPS.
Корневой сертификат ставится на телефон один раз; сертификат компа перевыпускается сам, если сменился IP.
"""
import datetime
import ipaddress
import os
import socket

from paths import read_json, write_json

TLS_DIR = os.path.join(os.environ.get('LOCALAPPDATA') or os.path.expanduser('~'), 'Graphite', 'tls')
CA_KEY, CA_CRT = os.path.join(TLS_DIR, 'ca.key'), os.path.join(TLS_DIR, 'ca.crt')
SRV_KEY, SRV_CRT = os.path.join(TLS_DIR, 'server.key'), os.path.join(TLS_DIR, 'server.crt')
SRV_META = os.path.join(TLS_DIR, 'server.json')


def lan_ips():
    """IP-адреса компа в домашней сети (без виртуальных адаптеров, если можно отличить)."""
    ips = set()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(('10.255.255.255', 1))  # пакет не уходит — так узнаём основной адрес
            ips.add(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    good = [ip for ip in ips if ipaddress.ip_address(ip).is_private and not ip.startswith(('127.', '169.254.'))]
    # основной адрес (из маршрута) — первым
    return sorted(good, key=lambda ip: (not ip.startswith('192.168.'), ip))


def _x509():
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID
    return x509, hashes, serialization, ec, NameOID


def ensure_certs():
    """Создаёт CA (один раз) и сертификат компа под текущие адреса. Возвращает (cert, key) или None."""
    try:
        x509, hashes, serialization, ec, NameOID = _x509()
    except ImportError:
        return None
    os.makedirs(TLS_DIR, exist_ok=True)
    now = datetime.datetime.now(datetime.timezone.utc)
    pem = serialization.Encoding.PEM
    nokey = serialization.NoEncryption()
    if not (os.path.exists(CA_KEY) and os.path.exists(CA_CRT)):
        key = ec.generate_private_key(ec.SECP256R1())
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Нарезчик (домашний сертификат)'),
                          x509.NameAttribute(NameOID.ORGANIZATION_NAME, 'Нарезчик')])
        cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
                .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(days=1))
                .not_valid_after(now + datetime.timedelta(days=3650))
                .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
                .add_extension(x509.KeyUsage(digital_signature=True, key_cert_sign=True, crl_sign=True, content_commitment=False,
                                             key_encipherment=False, data_encipherment=False, key_agreement=False,
                                             encipher_only=False, decipher_only=False), critical=True)
                .sign(key, hashes.SHA256()))
        with open(CA_KEY, 'wb') as f:
            f.write(key.private_bytes(pem, serialization.PrivateFormat.PKCS8, nokey))
        with open(CA_CRT, 'wb') as f:
            f.write(cert.public_bytes(pem))
    ips = lan_ips()
    host = socket.gethostname()
    want = {'ips': ips, 'host': host}
    if os.path.exists(SRV_CRT) and read_json(SRV_META) == want:
        return SRV_CRT, SRV_KEY
    ca_key = serialization.load_pem_private_key(open(CA_KEY, 'rb').read(), None)
    ca_cert = x509.load_pem_x509_certificate(open(CA_CRT, 'rb').read())
    key = ec.generate_private_key(ec.SECP256R1())
    san = [x509.DNSName('localhost'), x509.DNSName(host), x509.DNSName(f'{host}.local'), x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]
    san += [x509.IPAddress(ipaddress.ip_address(ip)) for ip in ips]
    cert = (x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, host)]))
            .issuer_name(ca_cert.subject).public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(days=1)).not_valid_after(now + datetime.timedelta(days=397))  # iOS: не больше 398 дней
            .add_extension(x509.SubjectAlternativeName(san), critical=False)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
            .sign(ca_key, hashes.SHA256()))
    with open(SRV_KEY, 'wb') as f:
        f.write(key.private_bytes(pem, serialization.PrivateFormat.PKCS8, nokey))
    with open(SRV_CRT, 'wb') as f:
        f.write(cert.public_bytes(pem) + ca_cert.public_bytes(pem))
    write_json(SRV_META, want)
    return SRV_CRT, SRV_KEY
