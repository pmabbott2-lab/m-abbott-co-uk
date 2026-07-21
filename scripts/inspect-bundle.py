import re
c = open("dist/client/assets/index-CWk1U1Y2.js").read()
idx = c.find("function ku(e)")
print(c[idx:idx+2000])
