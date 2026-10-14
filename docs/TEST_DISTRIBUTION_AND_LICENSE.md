# Licensing and test distribution / 许可与测试版分发

## License / 许可证

TeXWeave is licensed under the **PolyForm Internal Use License 1.0.0**. The complete, unmodified official English text is in the root [`LICENSE`](../LICENSE) file. The official source is <https://polyformproject.org/licenses/internal-use/1.0.0>.

TeXWeave 采用 **PolyForm Internal Use License 1.0.0**。完整、未经修改的官方英文文本保存在根目录的 [`LICENSE`](../LICENSE) 文件中。官方来源为 <https://polyformproject.org/licenses/internal-use/1.0.0>。

The license permits use and modification for the internal business operations of the recipient and their company. “Internal use” refers to the recipient and their company, not exclusively to the TeXWeave development team. The license does not grant permission to redistribute, sublicense, or transfer license rights. Uses outside the license require separate authorization from the relevant rights holders. This summary does not replace or modify the license text.

该许可证允许接收者为自己及其公司的内部业务使用和修改软件。“内部使用”针对接收者及其公司，并非仅指 TeXWeave 开发团队内部。许可证不授予再分发、转许可或转让许可权利的权限。超出许可证范围的使用需要相关权利人的单独授权。本说明不替代或修改许可证原文。

This is a license with restrictions on purpose and redistribution, not an unrestricted open-source license. The npm metadata uses `SEE LICENSE IN LICENSE` to refer to the complete terms; packages remain private.

这是对用途和再分发有限制的许可证，并非允许自由再分发的开源许可证。npm 元数据使用 `SEE LICENSE IN LICENSE` 指向完整条款；包仍保留 private 设置。

## Source access / 源码访问

Changing the license does not make the repository public. Internal testers and developers may continue to receive named access to the private repository. Repository access, confidentiality, and account security are separate from the permissions granted by the license. Distribute the license with any source copies supplied by the rights holders.

修改许可证不会自动将仓库公开。内部测试人员和开发者仍可通过指定账号访问私有仓库。仓库访问权限、保密约定和账号安全要求与许可证授予的使用权限是不同事项。权利人提供源码副本时应同时提供许可证。

## Binary test releases / 二进制测试版

Project maintainers acting with the rights holders' authorization may distribute versioned Windows x64 portable builds to testers. Recipients use them under the same license and are not granted redistribution rights. Keep invitation-only downloads access-controlled when that is the intended distribution policy.

经权利人授权的项目维护者可以向测试人员提供带版本号的 Windows x64 便携版。接收者按同一许可证使用软件，不因此获得再分发权限。如测试仅面向受邀人员，下载渠道应保留访问控制。

Future builds include `LICENSE` in the application archive and beside the unpacked executable. When distributing only the portable executable, also provide the root `LICENSE` file and the generated SHA-256 checksum with the download. Previously built executables are not changed by updating the repository license.

后续构筑会将 `LICENSE` 放入应用归档，并置于解包后的程序旁。只提供便携版可执行文件时，也应在下载处附上根目录 `LICENSE` 文件和生成的 SHA-256 校验文件。更新仓库许可证不会改变已经生成的旧版可执行文件。

## Third-party materials / 第三方材料

Third-party components, fonts, dictionaries, and resources remain governed by their own licenses. This change does not relicense them. Preserve their applicable license texts and notices, and review the actual packaged dependencies before distribution. A future `THIRD-PARTY-NOTICES` file must reflect the materials included in that specific build.

第三方组件、字体、词典和资源仍受其各自许可证约束，本次修改不会更改它们的许可。应保留适用的许可文本和声明，并在分发前核对实际打包的依赖。后续 `THIRD-PARTY-NOTICES` 文件应反映该构筑实际包含的材料。

## Future license changes / 后续许可变更

Any later move to a different license should review contributor rights and third-party materials and update the license, package metadata, source documentation, and binary distribution notices together.

以后改用其他许可证时，应核对贡献者权利和第三方材料，并同步更新许可证、包元数据、源码文档和二进制分发声明。
