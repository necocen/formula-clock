"""Strict symbolic value/domain checks for expressions outside the bounded solver."""
import json
import sys
import sympy as sp


def evaluate(ast, code):
    op = ast['op']
    if op == 'lit':
        return sp.Integer(code[ast['i']:ast['j']])
    a = evaluate(ast['a'], code)
    if op == 'neg':
        result = -a
    elif op == 'sqrt':
        if a.is_nonnegative is not True:
            raise ValueError('square root requires a nonnegative real operand')
        result = sp.sqrt(a)
    elif op == 'fact':
        if a.is_integer is not True or a.is_nonnegative is not True:
            raise ValueError('factorial requires a nonnegative integer')
        result = sp.factorial(a)
    else:
        b = evaluate(ast['b'], code)
        if op == 'add':
            result = a + b
        elif op == 'sub':
            result = a - b
        elif op == 'mul':
            result = a * b
        elif op == 'div':
            if b.is_zero is not False:
                raise ValueError('division requires a nonzero denominator')
            result = a / b
        elif op == 'pow':
            if a.is_zero is True and b.is_positive is not True:
                raise ValueError('zero to a nonpositive power is undefined')
            result = a ** b
        else:
            raise ValueError('unknown operation')
    if result.is_real is not True or result.is_finite is not True:
        raise ValueError('each intermediate result must be finite and real')
    return result


def verify(records):
    results = []
    for record in records:
        try:
            value = evaluate(record['ast'], record['code'])
            matches = sp.simplify(value - sp.Integer(record['second'])) == 0
            results.append({'valid': matches, 'reason': None if matches else 'value mismatch'})
        except (ValueError, TypeError, ArithmeticError) as error:
            results.append({'valid': False, 'reason': str(error)})
    return results


if __name__ == '__main__':
    print(json.dumps({'sympy': sp.__version__, 'results': verify(json.load(sys.stdin))}))
