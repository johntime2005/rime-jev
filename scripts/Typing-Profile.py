"""Generate an opt-in Rime Ice Jev spelling patch; never install or deploy it."""
import argparse
import json
from pathlib import Path


FUZZY = {
    'z-zh': ['derive/^zh/z/', 'derive/^z([^h])/zh$1/'],
    'c-ch': ['derive/^ch/c/', 'derive/^c([^h])/ch$1/'],
    's-sh': ['derive/^sh/s/', 'derive/^s([^h])/sh$1/'],
    'n-l': ['derive/^n/l/', 'derive/^l/n/'],
    'f-h': ['derive/^f/h/', 'derive/^h/f/'],
    'r-l': ['derive/^r/l/', 'derive/^l/r/'],
    'an-ang': ['derive/an$/ang/', 'derive/ang$/an/'],
    'en-eng': ['derive/en$/eng/', 'derive/eng$/en/'],
    'in-ing': ['derive/in$/ing/', 'derive/ing$/in/'],
    'ian-iang': ['derive/ian$/iang/', 'derive/iang$/ian/'],
    'uan-uang': ['derive/uan$/uang/', 'derive/uang$/uan/'],
}

# The suffix an/ang rules already cover ian/iang and uan/uang as well.
NASAL_PAIRS = ['an-ang', 'en-eng', 'in-ing']


def profile(pairs):
    pairs = list(dict.fromkeys(pairs))
    if any(pair not in FUZZY for pair in pairs):
        raise ValueError('Unknown fuzzy pair')
    lines = ['# Generated opt-in patch. Review before placing in your Rime user directory.',
             '# Keeps inherited abbreviations/corrections; fuzzy rules precede abbreviations.',
             'patch:', '  translator/prism: rime_ice_jev',
             '  translator/user_dict: rime_ice', '  translator/enable_user_dict: true',
             '  translator/enable_sentence: true', '  translator/enable_word_completion: true']
    rules = [rule for pair in pairs for rule in FUZZY[pair]]
    for index, rule in enumerate(rules):
        lines.append(f'  "speller/algebra/@before {index}": {json.dumps(rule)}')
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument('--fuzzy', nargs='*', choices=list(FUZZY), default=[])
    selection.add_argument('--nasal', action='store_true', help='Front/back nasals only; includes ian/iang and uan/uang')
    parser.add_argument('--output', type=Path, required=True, help='New file only; existing files are never overwritten')
    args = parser.parse_args()
    with args.output.open('x', encoding='ascii', newline='\n') as output:
        output.write(profile(NASAL_PAIRS if args.nasal else args.fuzzy))
    print(f'Generated {args.output}; not installed. No dictionaries or credentials changed.')


if __name__ == '__main__':
    main()
