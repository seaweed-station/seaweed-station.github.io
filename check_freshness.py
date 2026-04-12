"""Check data freshness for all tables."""
import json, os, re
from datetime import datetime, timezone

data_root = os.path.join(os.path.dirname(__file__), 'data')

# Load station list from config.json
folders = {}
cfg_path = os.path.join(os.path.dirname(__file__), 'config.json')
try:
    with open(cfg_path, 'r', encoding='utf-8') as f:
        cfg = json.load(f)
    for s in cfg.get('stations', []):
        if s.get('dataFolder'):
            folders[s.get('name', s['id'])] = s['dataFolder']
except Exception:
    # Fallback – keep in sync with config.json
    folders = {
        'Shangani Aramani': 'data_Shangani',
        'Funzi Island': 'data_Funzi',
        'Spare': 'data_spare',
        'Perth Test': 'data_3262071_TT',
    }

now = datetime.now(timezone.utc)

for name, folder in folders.items():
    path = os.path.join(data_root, folder, 'merged_data.js')
    if not os.path.exists(path):
        print(f"{name:12s}: NO merged_data.js")
        continue
    
    content = open(path, 'r', encoding='utf-8').read()
    # Find download timestamp
    dl_match = re.search(r'Downloaded:\s*(.+)', content)
    dl_time = dl_match.group(1).strip() if dl_match else 'unknown'
    
    # Parse JSON
    json_start = content.index('{')
    json_str = content[json_start:].rstrip().rstrip(';')
    data = json.loads(json_str)
    
    # Find latest entry
    feeds = data.get('feeds', [])
    temp_feeds = data.get('tempFeeds', [])
    all_feeds = feeds if feeds else temp_feeds
    
    if all_feeds:
        latest_ts = all_feeds[-1].get('created_at', '')
        latest_dt = datetime.fromisoformat(latest_ts.replace('Z', '+00:00'))
        age = now - latest_dt
        age_str = f"{age.seconds // 3600}h {(age.seconds % 3600) // 60}m"
        if age.days > 0:
            age_str = f"{age.days}d {age_str}"
        print(f"{name:12s}: {len(all_feeds)} entries | Latest: {latest_ts} | Age: {age_str} | Downloaded: {dl_time}")
    else:
        print(f"{name:12s}: 0 entries | Downloaded: {dl_time}")
