<?php
namespace Brace\UiKit\CoreUi;
use Brace\UiKit\CoreUi\Template\Renderer;
use function Brace\UiKit\CoreUi\el;
use function Brace\UiKit\CoreUi\txt;

/**
 * @var CoreUiConfig $__CONFIG
 * @var string $__CONTENT
 * @var Renderer $this
 */

?>
<!DOCTYPE html>
<html lang="<?php txt($__CONFIG->lang) ?>">
<head>
    <base href="./">
    <?php
    foreach ($__CONFIG->meta as $name => $content) {
        el("meta @name=? @content=?", [$name, $content]);
    }
    el(["title" => $__CONFIG->title]);

    foreach ($__CONFIG->cssLinkHead as $link) {
        el("link @href=? @rel=stylesheet", [$link]);
    }

    foreach ($__CONFIG->jsLinkHead as $link) {
        el("script @src=?", [$link]);
    }
    ?>

</head>
<body>
<?php echo $__CONTENT; ?>
<?php
foreach ($__CONFIG->jsLinkFooter as $link) {
    el("script @src=?", [$link]);
}
?>
</body>
</html>