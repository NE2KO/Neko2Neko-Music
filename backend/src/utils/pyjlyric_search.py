#!/usr/bin/env python3
"""Search Japanese lyrics from multiple sites using pyjlyric parsers."""
import sys
import json
import argparse
import urllib.request
import urllib.parse
import re

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; MediaVault/1.0)"}

def fetch_url(url, timeout=10):
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except Exception:
        return None

def extract_plain_lyrics(page):
    """Extract plain text lyrics from pyjlyric page object."""
    if not page or not page.lyric_sections:
        return None
    lines = []
    for section in page.lyric_sections:
        for line in section:
            text = line.text if hasattr(line, 'text') else str(line)
            if text and text.strip():
                lines.append(text.strip())
    return "\n".join(lines) if lines else None

def search_jlyric(query):
    """Search j-lyric.net for lyrics."""
    url = f"https://j-lyric.net/search.aspx?keyword={urllib.parse.quote(query)}&search=x"
    html = fetch_url(url)
    if not html:
        return []
    links = re.findall(r'href="(https://j-lyric\.net/artist/[^"]+\.html)"', html)
    results = []
    for link in links[:5]:
        try:
            from pyjlyric.jlyric import JlyricLyricPageParser
            page = JlyricLyricPageParser.parse(link)
            lyrics = extract_plain_lyrics(page)
            if lyrics:
                results.append({
                    "trackName": page.title or "",
                    "artistName": page.artist or "",
                    "plainLyrics": lyrics,
                    "source": "J-Lyric",
                    "url": link,
                })
        except Exception:
            continue
    return results

def search_utanet(query):
    """Search uta-net.com for lyrics."""
    url = f"https://www.uta-net.com/search/?Aession=&Keyword={urllib.parse.quote(query)}&Aession=&x=0&y=0"
    html = fetch_url(url)
    if not html:
        return []
    links = re.findall(r'href="(/song/\d+/)"', html)
    results = []
    for link in links[:3]:
        full_url = f"https://www.uta-net.com{link}"
        try:
            from pyjlyric.utanet import UtanetLyricPageParser
            page = UtanetLyricPageParser.parse(full_url)
            lyrics = extract_plain_lyrics(page)
            if lyrics:
                results.append({
                    "trackName": page.title or "",
                    "artistName": page.artist or "",
                    "plainLyrics": lyrics,
                    "source": "Uta-Net",
                    "url": full_url,
                })
        except Exception:
            continue
    return results

def search_utaten(query):
    """Search utaten.com for lyrics."""
    url = f"https://utaten.com/search?search_key={urllib.parse.quote(query)}"
    html = fetch_url(url)
    if not html:
        return []
    links = re.findall(r'href="(https://utaten\.com/lyric/[^"]+)"', html)
    results = []
    for link in links[:3]:
        try:
            from pyjlyric.utaten import UtatenLyricPageParser
            page = UtatenLyricPageParser.parse(link)
            lyrics = extract_plain_lyrics(page)
            if lyrics:
                results.append({
                    "trackName": page.title or "",
                    "artistName": page.artist or "",
                    "plainLyrics": lyrics,
                    "source": "Utaten",
                    "url": link,
                })
        except Exception:
            continue
    return results

def search_kashinavi(query):
    """Search kashinavi.com for lyrics."""
    url = f"https://kashinavi.com/search.php?k={urllib.parse.quote(query)}"
    html = fetch_url(url)
    if not html:
        return []
    links = re.findall(r'href="(https://kashinavi\.com/song/\d+\.html)"', html)
    results = []
    for link in links[:3]:
        try:
            from pyjlyric.kashinavi import KashinaviLyricPageParser
            page = KashinaviLyricPageParser.parse(link)
            lyrics = extract_plain_lyrics(page)
            if lyrics:
                results.append({
                    "trackName": page.title or "",
                    "artistName": page.artist or "",
                    "plainLyrics": lyrics,
                    "source": "Kashinavi",
                    "url": link,
                })
        except Exception:
            continue
    return results

ALL_SEARCHERS = [
    ("J-Lyric", search_jlyric),
    ("Uta-Net", search_utanet),
    ("Utaten", search_utaten),
    ("Kashinavi", search_kashinavi),
]

def main():
    parser = argparse.ArgumentParser(description='Search Japanese lyrics')
    parser.add_argument('query', help='Search query')
    parser.add_argument('--max', type=int, default=5, help='Max results')
    args = parser.parse_args()

    all_results = []
    seen = set()
    for name, searcher in ALL_SEARCHERS:
        try:
            results = searcher(args.query)
            for r in results:
                key = f"{r['trackName']}|{r['artistName']}"
                if key not in seen:
                    seen.add(key)
                    all_results.append(r)
        except Exception:
            continue
        if len(all_results) >= args.max:
            break

    print(json.dumps(all_results[:args.max], ensure_ascii=False))

if __name__ == '__main__':
    main()
