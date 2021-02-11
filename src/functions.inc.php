<?php
namespace Brace\UiKit\CoreUi;

function el($element, array $params = []) : void
{
    echo fhtml($element, $params)->render();
}

function txt($unescaped)
{
    echo htmlspecialchars($unescaped);
}