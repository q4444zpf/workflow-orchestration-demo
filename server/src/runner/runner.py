import json
import sys
import os
import traceback

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

        exec(code, env)

        output = env.get('OUTPUT')
        print('__RESULT_START__')
        print(json.dumps({'output': output, 'success': True}))
        print('__RESULT_END__')
    except Exception as e:
        print('__RESULT_START__')
        print(json.dumps({'success': False, 'error': str(e), 'traceback': traceback.format_exc()}))
        print('__RESULT_END__')
        sys.exit(1)


if __name__ == '__main__':
    main()
