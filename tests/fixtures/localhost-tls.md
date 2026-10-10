# Local transport test certificate

`localhost-cert.pem` and `localhost-key.pem` are a public, self-signed test pair
for loopback-only HTTP/2 and HTTPS test servers. They are not user credentials.
The certificate is valid from 2020-01-01 to 2040-01-01 to avoid clock-dependent
CI failures. Tests trust it only through the injected `ca` constructor option;
production uses normal certificate/hostname validation and never loads it.
