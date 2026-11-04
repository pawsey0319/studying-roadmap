#!/bin/bash
# 把网页文件复制到 app/www（安装包里的内容）。不带 sw.js：App 里不用缓存程序，网页文件随安装包更新。
set -e
cd "$(dirname "$0")"
rm -rf www && mkdir -p www
R=..
cp -r $R/index.html $R/manifest.webmanifest $R/icons $R/src $R/content $R/vendor www/
mkdir -p www/data && cp $R/data/*.json www/data/ 2>/dev/null || true
[ -f $R/config.json ] && cp $R/config.json www/ || true
echo "已复制网页文件到 app/www"
