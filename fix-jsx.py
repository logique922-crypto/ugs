import re
import os

files = [
    'src/components/BonDeLivraisonPrintModal.tsx',
    'src/components/FacturePrintModal.tsx',
    'src/components/BonDeSortiePrintModal.tsx',
    'src/components/BonDAchatPrintModal.tsx'
]

for f in files:
    with open(f, 'r', encoding='utf-8') as file:
        content = file.read()
        
    # Strip table start
    content = re.sub(r'<table className="w-full border-none">\s*<tbody>\s*<tr>\s*<td className="[^"]*">\s*', '', content)
    
    # Strip table end and tfoot
    content = re.sub(r'\s*<\/td>\s*<\/tr>\s*<\/tbody>\s*<tfoot[^>]*>\s*<tr>\s*<td[^>]*>\s*<div[^>]*><\/div>\s*<\/td>\s*<\/tr>\s*<\/tfoot>\s*<\/table>', '', content)
    
    # Also strip the extra divs I added previously at the end.
    content = re.sub(r'(<\/div>\s*)+\)\s*;\s*}\s*$', '\n      </div>\n    </div>\n  );\n}\n', content)
    
    # Now re-insert the table structure correctly
    content = re.sub(
        r'(<div className="p-0 bg-white block min-h-\[calc\(297mm-350px\)\]">)',
        r'<table className="w-full border-none">\n          <tbody>\n            <tr>\n              <td className="p-0 border-none align-top">\n                \1',
        content
    )
    
    # Find the footer and put table end before it
    content = re.sub(
        r'(\n\s*\{\/\*.*FOOTER.*?\*\/\}\s*)?(<div className="w-full bg-\[#102F57\])',
        r'\n              </td>\n            </tr>\n          </tbody>\n          <tfoot className="hidden print:table-footer-group">\n            <tr>\n              <td className="border-none p-0">\n                <div className="h-[80px]"></div>\n              </td>\n            </tr>\n          </tfoot>\n        </table>\n\n        \1\2',
        content
    )
    
    with open(f, 'w', encoding='utf-8') as file:
        file.write(content)

print("Done")
