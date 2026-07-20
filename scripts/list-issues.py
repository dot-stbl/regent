import json
with open('/tmp/issues.json') as f:
    data = json.load(f)
data.sort(key=lambda i: i['number'])
print(f'Total issues: {len(data)}')
for i in data:
    state = i['state']
    labels = ','.join(l['name'] for l in i['labels'])
    title = i['title'][:75]
    print(f'  #{i["number"]:3d} [{state:6s}] {title:75s} [{labels}]')
