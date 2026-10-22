# Generated capability catalog / 自动生成的能力清单

Generated from compiled definitions by `build-capabilities.cjs`. Do not edit by hand. / 由编译后的定义生成，请勿手工编辑。

Availability and approval are checked at execution time. / 可用性与权限在执行时重新检查。

| Capability ID | Handler | Effect / 副作用 | Scope / 范围 |
| --- | --- | --- | --- |
| build.environment.status | environment.read | none | global |
| customization.blocks.list | customization.read | none | global, project |
| customization.blocks.read | customization.read | none | global, project |
| customization.blocks.upsert | customization.write | reversible | global, project |
| customization.commands.list | customization.read | none | global, project |
| customization.commands.read | customization.read | none | global, project |
| customization.commands.upsert | customization.write | reversible | global, project |
| project.delete_block | project.delete_block | reversible | project |
| project.find_blocks | project.find_blocks | none | project |
| project.get_block | project.get_block | none | project |
| project.get_block_source | project.get_block_source | none | project |
| project.get_blocks | project.get_blocks | none | project |
| project.insert_block | project.insert_block | reversible | project |
| project.list_blocks | project.list_blocks | none | project |
| project.relation_find_path | project.relation_find_path | none | project |
| project.relation_get_dependents | project.relation_get_dependents | none | project |
| project.relation_get_display_scope | project.relation_get_display_scope | none | project |
| project.relation_get_logic_context | project.relation_get_logic_context | none | project |
| project.relation_get_prerequisites | project.relation_get_prerequisites | none | project |
| project.relation_get_scope | project.relation_get_scope | none | project |
| project.relation_get_subgraph | project.relation_get_subgraph | none | project |
| project.relation_graph_state | project.relation_graph_state | none | project |
| project.relation_propose_create | project.relation_propose_create | reversible | project |
| project.relation_propose_delete | project.relation_propose_delete | reversible | project |
| project.relation_propose_reverse | project.relation_propose_reverse | reversible | project |
| project.relation_validate | project.relation_validate | none | project |
| project.replace_block_content | project.replace_block_content | reversible | project |
| project.replace_block_range | project.replace_block_range | reversible | project |
| project.set_block_semantic | project.set_block_semantic | reversible | project |
| project.texweave_compile | project.texweave_compile | reversible | project |
| project.texweave_list_project_files | project.texweave_list_project_files | none | project |
| project.texweave_materialize_files | project.texweave_materialize_files | reversible | project |
| project.texweave_set_main_file | project.texweave_set_main_file | reversible | project |
| registry.status | registry.read | none | global |
| settings.aiShowTokenUsage.get | settings.read | none | global |
| settings.aiShowTokenUsage.set | settings.write | reversible | global |
| settings.autoPairSymbols.get | settings.read | none | global, project |
| settings.autoPairSymbols.set | settings.write | reversible | global, project |
| settings.confirmPreviewEdits.get | settings.read | none | global, project |
| settings.confirmPreviewEdits.set | settings.write | reversible | global, project |
| settings.engine.get | settings.read | none | global, project |
| settings.engine.set | settings.write | reversible | global, project |
| settings.fontSize.get | settings.read | none | global, project |
| settings.fontSize.set | settings.write | reversible | global, project |
| settings.mathPreviewOnHover.get | settings.read | none | global, project |
| settings.mathPreviewOnHover.set | settings.write | reversible | global, project |
| settings.pdfFollowActiveTex.get | settings.read | none | global, project |
| settings.pdfFollowActiveTex.set | settings.write | reversible | global, project |
| settings.showPreviewMetrics.get | settings.read | none | global |
| settings.showPreviewMetrics.set | settings.write | reversible | global |
| settings.sourceMinimap.get | settings.read | none | global, project |
| settings.sourceMinimap.set | settings.write | reversible | global, project |
| settings.theme.get | settings.read | none | global |
| settings.theme.set | settings.write | reversible | global |
| settings.wordWrap.get | settings.read | none | global, project |
| settings.wordWrap.set | settings.write | reversible | global, project |
| skills.list | skills.list | none | global |
| skills.read | skills.read | none | global |
| themes.create | themes.create | reversible | global |
| themes.list | themes.list | none | global |
| themes.read | themes.read | none | global |
