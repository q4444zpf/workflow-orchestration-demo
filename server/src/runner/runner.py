import json
import sys
import os
import traceback
from contextlib import redirect_stdout

TASK_DIR = '/tmp/task'


def main():
    try:
        with open(os.path.join(TASK_DIR, 'inputs.json'), 'r') as f:
            inputs = json.load(f)
        with open(os.path.join(TASK_DIR, 'code.py'), 'r') as f:
            code = f.read()

        env = {}
        env.update(inputs)
        env['OUTPUT'] = None

        # 用户的 print 与执行日志走 stderr，stdout 专用于有边界的结果协议。
        with redirect_stdout(sys.stderr):
            exec(code, env)

        output = env.get('OUTPUT')
        encoded = json.dumps(output, ensure_ascii=False, separators=(',', ':'))
        limit = int(os.environ.get('WORKFLOW_MAX_OUTPUT_BYTES', 1024 * 1024))
        if len(encoded.encode('utf-8')) > limit:
            raise ValueError(f'Python output exceeds limit of {limit} bytes')
        print('__RESULT_START__')
        print('{"output":' + encoded + ',"success":true}')
        print('__RESULT_END__')
    except Exception as e:
        print('__RESULT_START__')
        print(json.dumps({'success': False, 'error': str(e), 'traceback': traceback.format_exc()}))
        print('__RESULT_END__')
        sys.exit(1)


if __name__ == '__main__':
    main()
