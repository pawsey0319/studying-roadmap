"""Serial local MLX vision smoke; generated Chinese study card, never private screen."""
import argparse
import hashlib
import json
from pathlib import Path
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True, help='existing local model snapshot')
    parser.add_argument('--output', default='eval/results/local-vision.json')
    args = parser.parse_args()
    if not Path(args.model).is_dir():
        parser.error('local model snapshot required')
    from PIL import Image, ImageDraw, ImageFont
    root = Path(__file__).resolve().parents[1]
    image = root / 'eval/fixtures/study-card.png'
    image.parent.mkdir(parents=True, exist_ok=True)
    im = Image.new('RGB', (720, 420), 'white')
    draw = ImageDraw.Draw(im)
    font = ImageFont.truetype('/System/Library/Fonts/STHeiti Medium.ttc', 34)
    draw.text((32, 30), '学习计划', font=font, fill='black')
    draw.text((32, 110), '明天下午三点：英语口语', font=font, fill='black')
    draw.text((32, 190), '每日练习：20分钟', font=font, fill='black')
    draw.text((32, 270), '状态：未开始', font=font, fill='black')
    im.save(image)
    from mlx_vlm import load, generate
    from mlx_vlm.prompt_utils import apply_chat_template
    from mlx_vlm.utils import load_config
    import mlx.core as mx
    import psutil
    started = time.perf_counter()
    model, processor = load(args.model)
    load_seconds = time.perf_counter() - started
    prompt = '请读取图片，仅回答学习科目、计划时间、每日时长、当前状态。'
    config = load_config(args.model)
    formatted = apply_chat_template(processor, config, prompt, num_images=1, enable_thinking=False)
    started = time.perf_counter()
    result = generate(model, processor, formatted, [str(image)], max_tokens=128, temperature=0, verbose=False)
    text = result.text
    expected = ['英语', '三点', '20', '未开始']
    report = {'real_inference': True, 'scope': 'single_generated_card_not_benchmark', 'model_snapshot': Path(args.model).name,
              'fixture_sha256': hashlib.sha256(image.read_bytes()).hexdigest(), 'text': text,
              'literal_field_matches': {x: x in text for x in expected}, 'load_seconds': round(load_seconds, 3),
              'inference_seconds': round(time.perf_counter() - started, 3), 'process_rss_bytes': psutil.Process().memory_info().rss,
              'mlx_peak_bytes': mx.get_peak_memory()}
    output = root / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
