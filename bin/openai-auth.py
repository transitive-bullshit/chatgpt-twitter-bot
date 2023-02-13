#!/usr/bin/python3
# -*- coding: UTF-8 -*-

import re
import os
import argparse
from os import environ
import OpenAIAuth

from OpenAIAuth.OpenAIAuth import OpenAIAuth

def email_type(value: str) -> str:
    """validator on email"""
    email_pattern = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")
    if not email_pattern.match(value):
        raise argparse.ArgumentTypeError(f"'{value}' is not a valid email")
    return value


def login(email: str, password: str) -> str:
    """generate ChatGPT session_token by email and password"""
    auth = OpenAIAuth(
        email_address=email,
        password=password,
        proxy=os.environ.get("http_proxy", None)
    )
    auth.begin()
    access_token = auth.get_access_token()
    return access_token


def gen_argparser() -> argparse.Namespace:
    """generate argparser"""
    parser = argparse.ArgumentParser(description="generate ChatGPT seesion token")
    parser.add_argument("email", type=email_type, help="email address of your ChatGPT account")
    parser.add_argument("password", type=str, help="password of your ChatGPT account")
    arguments = parser.parse_args()
    return arguments


if __name__ == "__main__":
    args = gen_argparser()
    print(login(args.email, args.password))
