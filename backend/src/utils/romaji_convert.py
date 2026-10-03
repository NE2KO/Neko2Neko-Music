#!/usr/bin/env python3
"""Convert Japanese text to Romaji using pykakasi."""
import sys
import warnings
warnings.filterwarnings('ignore')

def to_romaji(text):
    from pykakasi import kakasi
    kks = kakasi()
    kks.setMode('J', 'a')
    conv = kks.getConverter()
    result = conv.convert(text)
    return ''.join(item['hepburn'] for item in result)

def main():
    text = sys.stdin.read() if len(sys.argv) > 1 and sys.argv[1] == '-' else sys.argv[1] if len(sys.argv) > 1 else ''
    if not text:
        return
    # Process line by line
    for line in text.split('\n'):
        print(to_romaji(line))

if __name__ == '__main__':
    main()
